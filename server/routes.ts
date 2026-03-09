import type { Express, Request, Response } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer as createHttpServer, type Server as HttpServer } from "http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "https";
import { createHash, randomBytes } from "crypto";
import { setupAuth, validatePasswordComplexity } from "./auth";
import { storage } from "./storage";
import {
  archivedJobs,
  commentReads,
  jobComments,
  offices,
  jobs,
  jobStatusHistory,
  notificationRules,
  users,
  jobFlags,
  insertJobSchema,
  insertJobCommentSchema,
  insertNotificationRuleSchema,
  insertInvitationSchema,
  insertSmsOptInSchema,
  insertAdminAuditLogSchema,
} from "@shared/schema";
import { sendSMS } from "./twilioClient";
import { requireAdmin, requireAuth, requireNotViewOnly, requireOffice, requireRole, requireSameOfficeParam } from "./middleware";
import { notifyJobStatusChange, notifyNewComment, notifyOverdueJob } from "./notification-service";
import {
  generateJobSummary,
  checkAndRegenerateSummary,
  isAiSummaryEnabled,
} from "./ai-summary-service";
import { getRecentErrors, getErrorStats, clearErrors } from "./error-logger";
import { db } from "./db";
import { and, desc, eq, sql } from "drizzle-orm";
import { hashSecret } from "./secret-hash";
import { activateHostForSetup, activateLicense, forceCheckin, getLicenseSnapshot, validateClaimForSetup } from "./license";
import { importSnapshotV1 } from "./migration-import";
import { normalizePatientNamePart } from "@shared/name-format";
import { ensureReadyForPickupTemplate } from "@shared/message-template-defaults";
import { broadcastToOffice } from "./sync-websocket";
import { buildLocalAuthEmail, isValidSixDigitPin, normalizeLoginId, validateLoginId } from "./auth-identifiers";
import type { User } from "@shared/schema";

// Type-safe user accessors for authenticated routes.
// These are safe to call in handlers guarded by requireAuth / requireOffice.
type OfficeUser = User & { officeId: string };

function getAuthUser(req: Request): User {
  return req.user as User;
}

function getOfficeUser(req: Request): OfficeUser {
  return req.user as OfficeUser;
}

// PHI access logging helper for HIPAA compliance
async function logPhiAccess(
  req: Request,
  action: 'view' | 'create' | 'update' | 'delete' | 'export',
  entityType: 'job' | 'comment' | 'archived_job' | 'patient_list',
  entityId: string,
  orderId?: string,
  details?: Record<string, any>
) {
  if (!req.user) return;
  
  try {
    const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
    const forwardedFor = trustProxy
      ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      : undefined;
    const ipAddress = forwardedFor || req.socket.remoteAddress || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    await storage.createPhiAccessLog({
      userId: getAuthUser(req).id,
      officeId: getAuthUser(req).officeId || null,
      action,
      entityType,
      entityId,
      orderId: orderId || null,
      ipAddress,
      userAgent,
      details: details || null,
    });
  } catch (error) {
    console.error('Failed to log PHI access:', error);
    // Don't throw - logging failure shouldn't break the request
  }
}

function withoutPassword<T extends Record<string, any> | null | undefined>(
  user: T,
): Omit<NonNullable<T>, "password" | "pinHash"> | null {
  if (!user || typeof user !== "object") return null;
  const { password: _password, pinHash: _pinHash, ...rest } = user as any;
  return rest;
}

export type AppServer = HttpServer | HttpsServer;

function createAppServer(app: Express): AppServer {
  if (process.env.OTTO_TLS !== "true") {
    return createHttpServer(app);
  }

  const keyPath = process.env.OTTO_TLS_KEY_PATH;
  const certPath = process.env.OTTO_TLS_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error("OTTO_TLS is true but OTTO_TLS_KEY_PATH/OTTO_TLS_CERT_PATH are not set");
  }

  return createHttpsServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    app,
  );
}

function normalizeRemoteIp(ip: string): string {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeRemoteIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function applyNoStoreHeaders(res: Response): void {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
}

function hashSnapshotPayload(payload: unknown): string {
  try {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  } catch {
    return "unavailable";
  }
}

type SetupHandshakeStatus = "pending" | "approved" | "denied" | "expired";

type SetupHandshakeRequest = {
  id: string;
  token: string;
  status: SetupHandshakeStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
  clientName: string;
  clientHost: string;
  clientVersion: string;
  requestedByIp: string;
};

const SETUP_HANDSHAKE_PENDING_LIMIT = 64;
const SETUP_HANDSHAKE_TTL_MS = 2 * 60 * 1000;
const SETUP_HANDSHAKE_RETENTION_MS = 10 * 60 * 1000;
const setupHandshakeRequests = new Map<string, SetupHandshakeRequest>();

// --- Handshake persistence to survive Host restarts ---
let _handshakeFilePath: string | null = null;
function handshakeFilePath(): string {
  if (_handshakeFilePath) return _handshakeFilePath;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  _handshakeFilePath = path.join(dataDir, "handshake-requests.json");
  return _handshakeFilePath;
}

function persistHandshakeRequests() {
  try {
    const entries = Array.from(setupHandshakeRequests.entries());
    fs.writeFileSync(handshakeFilePath(), JSON.stringify(entries), "utf-8");
  } catch {
    // Non-critical — ignore write failures
  }
}

function loadHandshakeRequests() {
  try {
    const filePath = handshakeFilePath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf-8");
    const entries: [string, SetupHandshakeRequest][] = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    for (const [id, req] of entries) {
      if (id && req && typeof req.status === "string") {
        setupHandshakeRequests.set(id, req);
      }
    }
    // Immediately clean up expired entries
    cleanupSetupHandshakeRequests();
  } catch {
    // Non-critical — ignore load failures
  }
}

// Load persisted handshake state on module init
loadHandshakeRequests();

function generateSetupHandshakeId() {
  return randomBytes(16).toString("hex");
}

function sanitizeSetupHandshakeText(value: unknown, fallback: string, max = 120): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function cleanupSetupHandshakeRequests(now = Date.now()) {
  const idsToDelete: string[] = [];
  setupHandshakeRequests.forEach((req, id) => {
    if (req.status === "pending" && req.expiresAt <= now) {
      req.status = "expired";
      req.decidedAt = req.expiresAt;
      req.decisionNote = req.decisionNote || "Approval timed out on the Host.";
      setupHandshakeRequests.set(id, req);
      return;
    }

    if (req.status !== "pending") {
      const finalizedAt = req.decidedAt || req.expiresAt || req.createdAt;
      if (now - finalizedAt > SETUP_HANDSHAKE_RETENTION_MS) {
        idsToDelete.push(id);
      }
    }
  });
  for (const id of idsToDelete) {
    setupHandshakeRequests.delete(id);
  }
}

function buildSetupHandshakeClientResponse(req: SetupHandshakeRequest) {
  const status = req.status;
  const message =
    status === "approved"
      ? req.decisionNote || "Approved on the Host computer."
      : status === "denied"
        ? req.decisionNote || "Request denied on the Host computer."
        : status === "expired"
          ? req.decisionNote || "Approval request timed out."
          : "Waiting for approval on the Host computer.";

  return {
    ok: status === "approved",
    status,
    message,
    createdAt: req.createdAt,
    expiresAt: req.expiresAt,
    decidedAt: req.decidedAt,
  };
}

function buildSetupHandshakePromptPayload(req: SetupHandshakeRequest) {
  return {
    id: req.id,
    status: req.status,
    createdAt: req.createdAt,
    expiresAt: req.expiresAt,
    clientName: req.clientName,
    clientHost: req.clientHost,
    clientVersion: req.clientVersion,
    requestedByIp: req.requestedByIp,
  };
}

function withDefaultMessageTemplates(settingsInput: unknown): Record<string, any> {
  const settings =
    settingsInput && typeof settingsInput === "object" && !Array.isArray(settingsInput)
      ? { ...(settingsInput as Record<string, any>) }
      : {};
  settings.smsTemplates = ensureReadyForPickupTemplate(
    settings.smsTemplates,
    Array.isArray(settings.customStatuses) ? settings.customStatuses : undefined,
  );
  return settings;
}

function readSetupCodeFromBody(body: any): string {
  const candidates = [body?.setupCode, body?.claimCode, body?.activationCode];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function setupCodeLast4(setupCode: string): string {
  const compact = String(setupCode || "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!compact) return "";
  return compact.slice(-4);
}

function parseSetupActivationFailure(error: any): { status: number; message: string; code: string } {
  const status = typeof error?.statusCode === "number" ? error.statusCode : 0;
  const code = String(error?.code || "").trim().toUpperCase();
  const rawMessage = String(error?.message || "Activation failed")
    .replace(/^[A-Z0-9_]+:\s*/i, "")
    .trim();

  if (status === 409 || code === "HOST_ALREADY_ACTIVATED") {
    return {
      status: 409,
      message: "This office is already activated on another Host. In the portal, click “Replace Host”, then try again.",
      code: "HOST_ALREADY_ACTIVATED",
    };
  }

  if (code === "CLAIM_ENDPOINT_NOT_CONFIGURED") {
    return {
      status: 500,
      message: "Host Claim Code verification is not configured on the portal yet.",
      code: "REQUEST_FAILED",
    };
  }

  if (code === "CLAIM_ENDPOINT_NOT_FOUND") {
    return {
      status: 503,
      message:
        "This portal does not support Host Claim Codes yet. Use a legacy Activation Code for now or update the portal.",
      code: "REQUEST_FAILED",
    };
  }

  if (code === "CLAIM_NOT_FOUND" || code === "NOT_FOUND") {
    return {
      status: 404,
      message: "Host Claim Code was not found. Generate a new code in the portal and try again.",
      code: "CLAIM_NOT_FOUND",
    };
  }

  if (code === "CLAIM_INVALID" || code === "INVALID_CODE") {
    return {
      status: 400,
      message: rawMessage || "Host Claim Code is invalid. Check the code and try again.",
      code: "CLAIM_INVALID",
    };
  }

  if (code === "CLAIM_EXPIRED") {
    return {
      status: 410,
      message: rawMessage || "Host Claim Code has expired. Generate a new code in the portal.",
      code: "CLAIM_EXPIRED",
    };
  }

  if (code === "CLAIM_USED") {
    return {
      status: 409,
      message: rawMessage || "This Host Claim Code has already been used.",
      code: "CLAIM_USED",
    };
  }

  if (code === "RATE_LIMITED") {
    return {
      status: 429,
      message: rawMessage || "Too many attempts. Wait a minute and try again.",
      code: "RATE_LIMITED",
    };
  }

  if (code === "PORTAL_UNREACHABLE" || code === "PORTAL_TIMEOUT" || status >= 500 || status === 0) {
    return {
      status: 503,
      message:
        "Host setup requires internet to verify your Host Claim Code. Check internet access on this Host computer and try again.",
      code: "REQUEST_FAILED",
    };
  }

  if (status >= 400 && status < 500) {
    return {
      status,
      message: rawMessage || "Host Claim Code was not accepted. Generate a new code in the portal and try again.",
      code: "REQUEST_FAILED",
    };
  }

  return {
    status: 500,
    message: rawMessage || "Host setup could not verify your Host Claim Code.",
    code: "REQUEST_FAILED",
  };
}

export function registerRoutes(app: Express): { server: AppServer; sessionMiddleware: any } {
  // Setup authentication
  const sessionMiddleware = setupAuth(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/license/status", (_req, res) => {
    applyNoStoreHeaders(res);
    res.json(getLicenseSnapshot());
  });

  app.post("/api/license/activate", requireAuth, requireRole(["owner"]), async (req, res) => {
    applyNoStoreHeaders(res);
    try {
      const activationCode =
        typeof req.body?.activationCode === "string" ? req.body.activationCode.trim() : "";
      const snapshot = await activateLicense(activationCode);
      res.json(snapshot);
    } catch (error: any) {
      const status = typeof error?.statusCode === "number" ? error.statusCode : 400;
      res.status(status).json({ error: error?.message || "Activation failed" });
    }
  });

  app.post("/api/license/checkin", requireAuth, requireRole(["owner"]), async (req, res) => {
    applyNoStoreHeaders(res);
    try {
      const snapshot = await forceCheckin();
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Check-in failed" });
    }
  });

  // Setup / onboarding routes (desktop-first)
  app.get("/api/setup/status", async (_req, res) => {
    try {
      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;

      const allOffices = officeCount > 0 ? await storage.getAllOffices() : [];
      const primaryOffice = allOffices[0];
      const selfSignupEnabled = officeCount === 1 && userCount > 0;

      res.json({
        initialized: officeCount > 0 && userCount > 0,
        officeId: primaryOffice?.id || null,
        officeName: primaryOffice?.name || null,
        selfSignupEnabled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to read setup status" });
    }
  });

  // Validate a claim code without consuming it — returns office + user details for pre-fill
  app.post("/api/setup/verify-claim", async (req, res) => {
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({ error: "Setup must be completed on the Host computer." });
    }

    const setupCode = readSetupCodeFromBody(req.body);
    if (!setupCode) {
      return res.status(400).json({ error: "Host Claim Code is required." });
    }

    try {
      const result = await validateClaimForSetup(setupCode);
      res.json(result);
    } catch (error: any) {
      const failure = parseSetupActivationFailure(error);
      res.status(failure.status).json({ error: failure.message, code: failure.code });
    }
  });

  app.post("/api/setup/handshake/request", async (req, res) => {
    try {
      cleanupSetupHandshakeRequests();

      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;
      if (officeCount < 1 || userCount < 1) {
        return res.status(409).json({ error: "Host setup is not complete yet." });
      }

      const pendingCount = Array.from(setupHandshakeRequests.values()).filter((item) => item.status === "pending").length;
      if (pendingCount >= SETUP_HANDSHAKE_PENDING_LIMIT) {
        return res.status(429).json({ error: "Too many pending approval requests. Please try again in a minute." });
      }

      const requestedByIp = normalizeRemoteIp(req.socket.remoteAddress || "") || "unknown";
      const clientName = sanitizeSetupHandshakeText(req.body?.clientName, "Client computer");
      const clientHost = sanitizeSetupHandshakeText(req.body?.clientHost, "", 160);
      const clientVersion = sanitizeSetupHandshakeText(req.body?.clientVersion, "", 60);

      const id = generateSetupHandshakeId();
      const token = generateSetupHandshakeId();
      const createdAt = Date.now();
      const expiresAt = createdAt + SETUP_HANDSHAKE_TTL_MS;

      const requestRecord: SetupHandshakeRequest = {
        id,
        token,
        status: "pending",
        createdAt,
        expiresAt,
        decidedAt: null,
        decisionNote: null,
        clientName,
        clientHost,
        clientVersion,
        requestedByIp,
      };
      setupHandshakeRequests.set(id, requestRecord);
      persistHandshakeRequests();

      res.status(201).json({
        ok: true,
        requestId: id,
        token,
        status: "pending",
        createdAt,
        expiresAt,
        message: "Waiting for approval on the Host computer.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Could not create approval request" });
    }
  });

  app.get("/api/setup/handshake/request/:id", async (req, res) => {
    try {
      cleanupSetupHandshakeRequests();

      const requestId = String(req.params.id || "").trim();
      const token = String(req.query.token || "").trim();
      const found = setupHandshakeRequests.get(requestId);
      if (!found) return res.status(404).json({ error: "Approval request not found." });
      if (!token || token !== found.token) {
        return res.status(403).json({ error: "Invalid approval token." });
      }

      res.json(buildSetupHandshakeClientResponse(found));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Could not read approval request" });
    }
  });

  app.get("/api/setup/handshake/pending", async (req, res) => {
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({ error: "Host approval queue is local-only." });
    }

    cleanupSetupHandshakeRequests();
    const pending = Array.from(setupHandshakeRequests.values())
      .filter((item) => item.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(buildSetupHandshakePromptPayload);

    res.json({ pending });
  });

  app.post("/api/setup/handshake/request/:id/decision", async (req, res) => {
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({ error: "Approval decisions are local-only." });
    }

    cleanupSetupHandshakeRequests();

    const requestId = String(req.params.id || "").trim();
    const found = setupHandshakeRequests.get(requestId);
    if (!found) {
      return res.status(404).json({ error: "Approval request not found." });
    }

    if (found.status !== "pending") {
      return res.json(buildSetupHandshakeClientResponse(found));
    }

    const decisionRaw = String(req.body?.decision || "").trim().toLowerCase();
    if (decisionRaw !== "approved" && decisionRaw !== "denied") {
      return res.status(400).json({ error: "Decision must be approved or denied." });
    }

    const decision = decisionRaw as "approved" | "denied";
    const noteFallback =
      decision === "approved"
        ? "Approved on the Host computer."
        : "Denied on the Host computer.";
    const note = sanitizeSetupHandshakeText(req.body?.note, noteFallback, 220);

    found.status = decision;
    found.decidedAt = Date.now();
    found.decisionNote = note;
    setupHandshakeRequests.set(requestId, found);
    persistHandshakeRequests();

    res.json(buildSetupHandshakeClientResponse(found));
  });

  app.post("/api/setup/bootstrap", async (req, res, next) => {
    // Do not trust proxy headers for setup restrictions.
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({
        error: "Setup must be completed on the Host computer.",
      });
    }

    try {
      const setupCode = readSetupCodeFromBody(req.body);
      const officeBody = req.body?.office || {};
      const adminBody = req.body?.admin || {};

      const officeName = typeof officeBody?.name === "string" ? officeBody.name.trim() : "";
      const officeAddress =
        typeof officeBody?.address === "string" ? officeBody.address.trim() : undefined;
      const officePhone = typeof officeBody?.phone === "string" ? officeBody.phone.trim() : undefined;
      const officeEmail = typeof officeBody?.email === "string" ? officeBody.email.trim() : undefined;

      const adminLoginIdRaw = typeof adminBody?.loginId === "string" ? adminBody.loginId : "";
      const adminEmailFallback = typeof adminBody?.email === "string" ? adminBody.email : "";
      const adminLoginId = normalizeLoginId(adminLoginIdRaw || adminEmailFallback.split("@")[0] || "");
      const adminPassword = typeof adminBody?.password === "string" ? adminBody.password : "";
      const adminPin = typeof adminBody?.pin === "string" ? adminBody.pin.trim() : "";
      const adminFirstName = typeof adminBody?.firstName === "string" ? adminBody.firstName.trim() : "";
      const adminLastName = typeof adminBody?.lastName === "string" ? adminBody.lastName.trim() : "";

      if (!setupCode) {
        return res.status(400).json({ error: "Host Claim Code is required" });
      }
      if (!officeName) {
        return res.status(400).json({ error: "Office name is required" });
      }
      const adminLoginIdError = validateLoginId(adminLoginId);
      if (adminLoginIdError) {
        return res.status(400).json({ error: adminLoginIdError });
      }
      if (!adminFirstName) {
        return res.status(400).json({ error: "Admin first name is required" });
      }
      if (!adminLastName) {
        return res.status(400).json({ error: "Admin last name is required" });
      }
      if (!isValidSixDigitPin(adminPin)) {
        return res.status(400).json({ error: "PIN must be exactly 6 digits." });
      }

      // Password is optional — if provided, validate complexity; otherwise a random placeholder is used.
      if (adminPassword) {
        const passwordValidation = validatePasswordComplexity(adminPassword);
        if (!passwordValidation.valid) {
          return res.status(400).json({
            error: "Password does not meet complexity requirements",
            details: passwordValidation.errors,
          });
        }
      }

      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;

      if (userCount > 0) {
        return res.status(409).json({ error: "This office is already set up." });
      }
      if (officeCount > 1) {
        return res.status(409).json({ error: "Multiple offices exist. Please contact support." });
      }

      const existingUser = await storage.getUserByLoginId(adminLoginId);
      if (existingUser) {
        return res.status(409).json({ error: "A user with this Login ID already exists." });
      }

      let licenseSnapshot = getLicenseSnapshot();
      try {
        licenseSnapshot = await activateHostForSetup(setupCode);
      } catch (error: any) {
        const failure = parseSetupActivationFailure(error);
        return res.status(failure.status).json({ error: failure.message, code: failure.code });
      }

      const office =
        officeCount === 1
          ? (await storage.getAllOffices())[0]
          : await storage.createOffice({
              name: officeName,
              address: officeAddress,
              phone: officePhone,
              email: officeEmail,
            });

      const mergedSettings: Record<string, any> = withDefaultMessageTemplates(office.settings || {});
      const activationSucceeded = licenseSnapshot.mode === "ACTIVE";
      const setupCodeTail = setupCodeLast4(setupCode);
      mergedSettings.licensing = {
        setupCodeLast4: setupCodeTail,
        activationCodeLast4: setupCodeTail,
        activationAttemptedAt: Date.now(),
        activationVerifiedAt: activationSucceeded ? licenseSnapshot.activatedAt || Date.now() : null,
      };

      const updatedOffice = await storage.updateOffice(office.id, {
        name: officeName,
        address: officeAddress,
        phone: officePhone,
        email: officeEmail,
        settings: mergedSettings,
      });

      let adminEmail = buildLocalAuthEmail(adminLoginId, updatedOffice.id);
      while (await storage.getUserByEmail(adminEmail)) {
        adminEmail = buildLocalAuthEmail(adminLoginId, updatedOffice.id);
      }

      // If no password provided, generate a random unguessable placeholder hash.
      const passwordHash = adminPassword
        ? await hashSecret(adminPassword)
        : await hashSecret(randomBytes(32).toString("hex"));

      const user = await storage.createUser({
        email: adminEmail,
        loginId: adminLoginId,
        firstName: adminFirstName,
        lastName: adminLastName,
        password: passwordHash,
        pinHash: await hashSecret(adminPin),
        officeId: updatedOffice.id,
        role: "owner",
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json({
          ok: true,
          office: updatedOffice,
          user: withoutPassword(user),
          license: licenseSnapshot,
        });
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Setup failed" });
    }
  });

  app.post("/api/setup/import-snapshot", async (req, res, next) => {
    // Do not trust proxy headers for setup restrictions.
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({
        error: "Import must be completed on the Host computer.",
      });
    }

    try {
      const setupCode = readSetupCodeFromBody(req.body);
      const snapshot = req.body?.snapshot;
      const officeBody = req.body?.office || {};
      const adminBody = req.body?.admin || {};

      const officeName = typeof officeBody?.name === "string" ? officeBody.name.trim() : "";
      const officeAddress = typeof officeBody?.address === "string" ? officeBody.address.trim() : undefined;
      const officePhone = typeof officeBody?.phone === "string" ? officeBody.phone.trim() : undefined;
      const officeEmail = typeof officeBody?.email === "string" ? officeBody.email.trim() : undefined;

      const adminLoginIdRaw = typeof adminBody?.loginId === "string" ? adminBody.loginId : "";
      const adminEmailFallback = typeof adminBody?.email === "string" ? adminBody.email : "";
      const adminLoginId = normalizeLoginId(adminLoginIdRaw || adminEmailFallback.split("@")[0] || "");
      const adminPassword = typeof adminBody?.password === "string" ? adminBody.password : "";
      const adminPin = typeof adminBody?.pin === "string" ? adminBody.pin.trim() : "";
      const adminFirstName = typeof adminBody?.firstName === "string" ? adminBody.firstName.trim() : "";
      const adminLastName = typeof adminBody?.lastName === "string" ? adminBody.lastName.trim() : "";

      if (!setupCode) {
        return res.status(400).json({ error: "Host Claim Code is required" });
      }
      if (!snapshot || typeof snapshot !== "object") {
        return res.status(400).json({ error: "Snapshot file is required" });
      }
      if (officeName) {
        try {
          const office = (snapshot as any)?.office;
          if (office && typeof office === "object") {
            (office as any).name = officeName;
            if (officeAddress !== undefined) (office as any).address = officeAddress;
            if (officePhone !== undefined) (office as any).phone = officePhone;
            if (officeEmail !== undefined) (office as any).email = officeEmail;
          }
        } catch {
          // ignore
        }
      }
      const adminLoginIdError = validateLoginId(adminLoginId);
      if (adminLoginIdError) {
        return res.status(400).json({ error: adminLoginIdError });
      }
      if (!adminFirstName) {
        return res.status(400).json({ error: "Admin first name is required" });
      }
      if (!adminLastName) {
        return res.status(400).json({ error: "Admin last name is required" });
      }
      if (!isValidSixDigitPin(adminPin)) {
        return res.status(400).json({ error: "PIN must be exactly 6 digits." });
      }

      // Password is optional — if provided, validate complexity; otherwise a random placeholder is used.
      if (adminPassword) {
        const passwordValidation = validatePasswordComplexity(adminPassword);
        if (!passwordValidation.valid) {
          return res.status(400).json({
            error: "Password does not meet complexity requirements",
            details: passwordValidation.errors,
          });
        }
      }

      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const [jobStats] = await db.select({ count: sql`count(*)` }).from(jobs);
      const [archivedStats] = await db.select({ count: sql`count(*)` }).from(archivedJobs);

      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;
      const jobCount = Number(jobStats?.count) || 0;
      const archivedCount = Number(archivedStats?.count) || 0;

      if (officeCount > 0 || userCount > 0 || jobCount > 0 || archivedCount > 0) {
        return res.status(409).json({
          error:
            "This Host already has data. Import is only available on a fresh install. If you’re trying to recover, use File → Restore Data… instead.",
        });
      }

      let licenseSnapshot = getLicenseSnapshot();
      try {
        licenseSnapshot = await activateHostForSetup(setupCode);
      } catch (error: any) {
        const failure = parseSetupActivationFailure(error);
        return res.status(failure.status).json({ error: failure.message, code: failure.code });
      }

      const adminPasswordHash = adminPassword
        ? await hashSecret(adminPassword)
        : await hashSecret(randomBytes(32).toString("hex"));
      const adminPinHash = await hashSecret(adminPin);

      const activationSucceeded = licenseSnapshot.mode === "ACTIVE";
      const activationVerifiedAt = activationSucceeded ? licenseSnapshot.activatedAt || Date.now() : null;
      const setupCodeTail = setupCodeLast4(setupCode);

      const result = importSnapshotV1({
        snapshot,
        admin: {
          loginId: adminLoginId,
          firstName: adminFirstName,
          lastName: adminLastName,
          passwordHash: adminPasswordHash,
          pinHash: adminPinHash,
        },
        activationCodeLast4: setupCodeTail,
        activationVerifiedAt,
      });

      const office = await storage.getOffice(result.officeId);
      const user = await storage.getUser(result.adminUserId);
      if (!office || !user) {
        return res.status(500).json({ error: "Import completed but could not load the new office." });
      }

      try {
        await storage.createAuditLog({
          adminId: user.id,
          action: "import_snapshot",
          targetType: "office",
          targetId: office.id,
          metadata: {
            format: (snapshot as any)?.format || "unknown",
            version: (snapshot as any)?.version || "unknown",
            exportedAt: (snapshot as any)?.exportedAt || null,
            snapshotSha256: hashSnapshotPayload(snapshot),
            importedCounts: result.importedCounts,
            synthesizedLegacyUsers: result.synthesizedLegacyUsers,
            activationVerified: activationSucceeded,
          },
        });
      } catch (auditError) {
        console.error("Failed to write import audit log:", auditError);
      }

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json({
          ok: true,
          office,
          user: withoutPassword(user),
          importedCounts: result.importedCounts,
          license: licenseSnapshot,
        });
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Import failed" });
    }
  });

  // Job routes
  app.get("/api/jobs", requireOffice, async (req, res) => {
    try {
      const jobs = await storage.getJobsByOffice(getOfficeUser(req).officeId);
      
      // Log PHI access for viewing patient list
      await logPhiAccess(req, 'view', 'patient_list', getOfficeUser(req).officeId, undefined, { jobCount: jobs.length });
      
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Check for duplicate tray number
  app.get("/api/jobs/check-tray-number", requireOffice, async (req, res) => {
    try {
      const { trayNumber, excludeJobId } = req.query;
      if (!trayNumber || typeof trayNumber !== 'string') {
        return res.status(400).json({ error: "Tray number is required" });
      }
      
      const existingJob = await storage.getJobByTrayNumber(
        getOfficeUser(req).officeId, 
        trayNumber,
        typeof excludeJobId === 'string' ? excludeJobId : undefined
      );
      
      res.json({ exists: !!existingJob, jobId: existingJob?.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const requestedId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (requestedId) {
        const existing = await storage.getJob(requestedId);
        if (existing && existing.officeId === getAuthUser(req).officeId) {
          return res.json(existing);
        }
      }

      // Get office settings to check identifier mode
      const office = await storage.getOffice(getOfficeUser(req).officeId);
      const officeSettings = (office?.settings || {}) as Record<string, any>;
      const jobIdentifierMode = officeSettings.jobIdentifierMode || "patientName";
      const normalizedFirstName = normalizePatientNamePart(req.body?.patientFirstName);
      const normalizedLastName = normalizePatientNamePart(req.body?.patientLastName);
      
      // Validate based on identifier mode
      if (jobIdentifierMode === "trayNumber") {
        if (!req.body.trayNumber || req.body.trayNumber.trim() === "") {
          return res.status(400).json({ error: "Tray number is required when using tray identifier mode" });
        }
        
        // Check for duplicate tray number
        const existingJob = await storage.getJobByTrayNumber(getOfficeUser(req).officeId, req.body.trayNumber.trim());
        if (existingJob) {
          return res.status(409).json({ 
            error: "Duplicate tray number", 
            message: "A job with this tray number already exists. Please check for accuracy.",
            existingJobId: existingJob.id 
          });
        }
      } else {
        if (!normalizedFirstName || !normalizedLastName) {
          return res.status(400).json({ error: "Patient first name and last name are required" });
        }
      }

      const normalizedBody =
        jobIdentifierMode === "trayNumber"
          ? { ...req.body, patientFirstName: "", patientLastName: "" }
          : {
              ...req.body,
              patientFirstName: normalizedFirstName,
              patientLastName: normalizedLastName,
            };
      
      const jobData = insertJobSchema.parse({
        ...normalizedBody,
        officeId: getAuthUser(req).officeId,
        createdBy: getAuthUser(req).id
      });
      
      const job = await storage.createJob(jobData);
      
      // Log PHI access for creating patient record
      await logPhiAccess(req, 'create', 'job', job.id, job.orderId, { 
        jobType: job.jobType,
        patientId: job.trayNumber || `${job.patientFirstName} ${job.patientLastName}`.trim()
      });
      
      res.status(201).json(job);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/jobs/:id", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const oldJob = await storage.getJob(req.params.id);
      if (!oldJob || oldJob.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const allowedFields = [
        "patientFirstName",
        "patientLastName",
        "trayNumber",
        "phone",
        "jobType",
        "status",
        "orderDestination",
        "customColumnValues",
        "isRedoJob",
        "originalJobId",
        "notes",
      ];

      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(rawBody, field)) {
          updates[field] = (rawBody as any)[field];
        }
      }

      // Trim string fields.
      for (const key of Object.keys(updates)) {
        if (typeof updates[key] === "string") {
          updates[key] = updates[key].trim();
        }
      }

      if (typeof updates.patientFirstName === "string") {
        updates.patientFirstName = normalizePatientNamePart(updates.patientFirstName);
      }
      if (typeof updates.patientLastName === "string") {
        updates.patientLastName = normalizePatientNamePart(updates.patientLastName);
      }

      for (const requiredKey of ["patientFirstName", "patientLastName", "jobType", "status", "orderDestination"]) {
        if (Object.prototype.hasOwnProperty.call(updates, requiredKey)) {
          const value = updates[requiredKey];
          if (typeof value !== "string" || !value.trim()) {
            return res.status(400).json({ error: `${requiredKey} is required` });
          }
        }
      }

      const trayNumberProvided = Object.prototype.hasOwnProperty.call(updates, "trayNumber");
      const requestedTrayNumber = typeof updates.trayNumber === "string" ? updates.trayNumber : "";
      
      // Check for duplicate tray number if tray number is being updated
      if (trayNumberProvided) {
        const office = await storage.getOffice(oldJob.officeId);
        const officeSettings = (office?.settings || {}) as Record<string, any>;
        const jobIdentifierMode = officeSettings.jobIdentifierMode || "patientName";
        
        if (jobIdentifierMode === "trayNumber") {
          if (!requestedTrayNumber) {
            return res.status(400).json({ error: "Tray number is required when using tray identifier mode" });
          }

          if (requestedTrayNumber !== oldJob.trayNumber) {
            const existingJob = await storage.getJobByTrayNumber(oldJob.officeId, requestedTrayNumber, req.params.id);
            if (existingJob) {
              return res.status(409).json({ 
                error: "Duplicate tray number", 
                message: "A job with this tray number already exists. Please check for accuracy.",
                existingJobId: existingJob.id 
              });
            }
          }
        }
      }
      
      const job = await storage.updateJob(req.params.id, updates as any, getAuthUser(req).id);
      
      // Log PHI access for updating patient record
      await logPhiAccess(req, 'update', 'job', job.id, job.orderId, { 
        updatedFields: Object.keys(updates),
        patientId: job.trayNumber || `${job.patientFirstName} ${job.patientLastName}`.trim()
      });
      
      if (oldJob && updates.status && oldJob.status !== updates.status) {
        // Send notifications while job still exists in database (fixes FK violation)
        await notifyJobStatusChange(job, oldJob.status, getAuthUser(req), storage);
        
        if (isAiSummaryEnabled()) {
          // Regenerate AI summary BEFORE archiving (while job still exists)
          await checkAndRegenerateSummary(req.params.id);
        }
        
        // Archive and delete AFTER notifications if status is terminal
        if (updates.status === 'completed' || updates.status === 'cancelled') {
          await storage.archiveJob(job);
          await storage.deleteJob(req.params.id);
        }
      }
      
      res.json(job);
    } catch (error: any) {
      console.error("PUT /api/jobs/:id - Error:", process.env.OTTO_DEBUG === "true" ? error : error?.message);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/jobs/:id", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Log PHI access before deletion
      await logPhiAccess(req, 'delete', 'job', job.id, job.orderId);
      
      await storage.deleteJob(job.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/jobs/:id/archive", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      if (job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const { finalStatus } = req.body;
      if (!finalStatus) {
        return res.status(400).json({ error: "finalStatus is required" });
      }

      // Update job status first
      const updatedJob = { ...job, status: finalStatus };
      
      // Archive the job
      const archivedJob = await storage.archiveJob(updatedJob);
      
      // Delete from active jobs
      await storage.deleteJob(req.params.id);
      
      res.json(archivedJob);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Archived jobs routes
  app.get("/api/jobs/archived", requireOffice, async (req, res) => {
    try {
      const { startDate, endDate, name } = req.query;
      const jobs = await storage.getArchivedJobsByOffice(
        getOfficeUser(req).officeId,
        startDate as string | undefined,
        endDate as string | undefined,
        name as string | undefined
      );
      
      // Log PHI access for viewing archived patient records
      await logPhiAccess(req, 'view', 'archived_job', getOfficeUser(req).officeId, undefined, { 
        jobCount: jobs.length,
        filters: { startDate, endDate, name }
      });
      
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs/archived/:id/restore", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const [archived] = await db
        .select({ id: archivedJobs.id, officeId: archivedJobs.officeId, orderId: archivedJobs.orderId })
        .from(archivedJobs)
        .where(eq(archivedJobs.id, req.params.id))
        .limit(1);

      if (!archived || archived.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Archived job not found" });
      }

      // newStatus is now optional - will use previousStatus from archive if not provided
      const { newStatus } = req.body;
      const job = await storage.restoreArchivedJob(req.params.id, newStatus);

      await logPhiAccess(req, "update", "archived_job", archived.id, archived.orderId, { restoredJobId: job.id });
      res.json(job);
    } catch (error: any) {
      console.error(
        "POST /api/jobs/archived/:id/restore - Error:",
        process.env.OTTO_DEBUG === "true" ? error : error?.message,
      );
      res.status(400).json({ error: error.message });
    }
  });

  // Overdue jobs
  app.get("/api/jobs/overdue", requireOffice, async (req, res) => {
    try {
      const overdueJobs = await storage.getOverdueJobs(getOfficeUser(req).officeId);
      res.json(overdueJobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/:jobId/status-history", requireOffice, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const rows = await db
        .select({
          id: jobStatusHistory.id,
          jobId: jobStatusHistory.jobId,
          oldStatus: jobStatusHistory.oldStatus,
          newStatus: jobStatusHistory.newStatus,
          changedAt: jobStatusHistory.changedAt,
          changedBy: jobStatusHistory.changedBy,
          changedByFirstName: users.firstName,
          changedByLastName: users.lastName,
        })
        .from(jobStatusHistory)
        .leftJoin(users, eq(jobStatusHistory.changedBy, users.id))
        .where(eq(jobStatusHistory.jobId, job.id))
        .orderBy(desc(jobStatusHistory.changedAt));

      res.json(
        rows.map((row) => ({
          id: row.id,
          jobId: row.jobId,
          oldStatus: row.oldStatus,
          newStatus: row.newStatus,
          changedAt: row.changedAt,
          changedBy: row.changedBy,
          changedByUser:
            row.changedByFirstName || row.changedByLastName
              ? {
                  firstName: row.changedByFirstName,
                  lastName: row.changedByLastName,
                }
              : null,
        })),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Job comments routes
  app.get("/api/jobs/:jobId/comments", requireOffice, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const comments = await storage.getJobComments(job.id);
      
      // Log PHI access for viewing comments
      await logPhiAccess(req, 'view', 'comment', job.id, job.orderId, { commentCount: comments.length });
      
      res.json(comments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs/:jobId/comments", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const requestedId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (requestedId) {
        const existingComments = await storage.getJobComments(job.id);
        const existing = existingComments.find((comment) => comment.id === requestedId);
        if (existing) {
          return res.json(existing);
        }
      }

      const commentData = insertJobCommentSchema.parse({
        ...req.body,
        jobId: req.params.jobId,
        authorId: getAuthUser(req).id
      });
      
      const comment = await storage.createJobComment(commentData);
      
      // Log PHI access for creating comment
      await logPhiAccess(req, 'create', 'comment', comment.id, job.orderId, { jobId: req.params.jobId });
      
      await notifyNewComment(job, comment, getAuthUser(req), storage);
      if (isAiSummaryEnabled()) {
        // Regenerate AI summary for flagged jobs when new comment is added
        await checkAndRegenerateSummary(req.params.jobId);
      }
      
      res.status(201).json(comment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/jobs/comments/:id", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const [existingComment] = await db
        .select()
        .from(jobComments)
        .where(eq(jobComments.id, req.params.id))
        .limit(1);

      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const job = await storage.getJob(existingComment.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      if (existingComment.authorId !== getAuthUser(req).id) {
        return res.status(403).json({ error: "Not authorized to edit this comment" });
      }
      
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Comment content is required" });
      }
      
      const updatedComment = await storage.updateJobComment(req.params.id, { content: content.trim() });
      
      // Log PHI access for updating comment
      await logPhiAccess(req, 'update', 'comment', req.params.id, job.orderId, { jobId: job.id });
      
      res.json(updatedComment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Comment reads routes
  app.get("/api/jobs/unread-comments", requireOffice, async (req, res) => {
    try {
      const unreadJobIds = await storage.getUnreadCommentJobIds(getOfficeUser(req).id, getOfficeUser(req).officeId);
      res.json(unreadJobIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/comment-counts", requireOffice, async (req, res) => {
    try {
      const commentCounts = await storage.getJobCommentCounts(getOfficeUser(req).officeId);
      res.json(commentCounts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/jobs/:jobId/comment-reads", requireOffice, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const commentRead = await storage.updateCommentRead(getAuthUser(req).id, req.params.jobId);
      res.json(commentRead);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Job flag routes
  app.post("/api/jobs/:jobId/flag", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Create flag immediately without waiting for summary
      const flag = await storage.flagJob(getAuthUser(req).id, req.params.jobId);
      
      const shouldGenerateAiSummary = isAiSummaryEnabled();

      // Only generate AI summaries when explicitly enabled for a hosted/online deployment.
      if (shouldGenerateAiSummary) {
        // Generate AI summary asynchronously in the background
        (async () => {
          try {
            if (process.env.OTTO_DEBUG === "true") {
              console.log(`[AI Summary] Starting async summary generation for job ${req.params.jobId}`);
            }
            const office = await storage.getOffice(job.officeId);
            const summary = await generateJobSummary(req.params.jobId, office?.settings || {});
            await storage.updateJobFlagAiSummary(getAuthUser(req).id, req.params.jobId, summary);
            if (process.env.OTTO_DEBUG === "true") {
              console.log(`[AI Summary] Async summary generation completed for job ${req.params.jobId}`);
            }
          } catch (error) {
            console.error(`[AI Summary] Error generating async summary for job ${req.params.jobId}:`, error);
          }
        })();
      }
      
      res.status(201).json(flag);
    } catch (error: any) {
      console.error("Error flagging job:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/jobs/:jobId/flag/note", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const note = typeof req.body?.note === "string" ? req.body.note : "";
      const trimmed = note.trim().slice(0, 4000);

      const [existingFlag] = await db
        .select({ id: jobFlags.id })
        .from(jobFlags)
        .where(and(eq(jobFlags.userId, getAuthUser(req).id), eq(jobFlags.jobId, req.params.jobId)));

      if (!existingFlag) {
        return res.status(404).json({ error: "This job isn’t starred by you yet." });
      }

      await storage.updateJobFlagImportantNote(getAuthUser(req).id, req.params.jobId, trimmed);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/jobs/:jobId/flag", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      await storage.unflagJob(getAuthUser(req).id, req.params.jobId);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/jobs/flagged", requireOffice, async (req, res) => {
    try {
      const flaggedJobs = await storage.getFlaggedJobsByOffice(getOfficeUser(req).officeId);
      res.json(flaggedJobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/:jobId/flagged-by", requireOffice, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const flaggedBy = await storage.getJobFlaggedBy(req.params.jobId);
      res.json(flaggedBy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI summary route
  app.post("/api/jobs/:jobId/summary", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      if (!isAiSummaryEnabled()) {
        return res.status(503).json({
          error: "AI summaries are disabled for this deployment.",
          code: "AI_DISABLED",
        });
      }

      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const office = await storage.getOffice(job.officeId);
      const summary = await generateJobSummary(req.params.jobId, office?.settings || {});
      
      res.json({ summary });
    } catch (error: any) {
      console.error("Error generating summary:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Office routes
  app.post("/api/offices", requireAuth, async (req, res) => {
    try {
      if (getAuthUser(req).officeId) {
        return res.status(400).json({ error: "You already belong to an office." });
      }

      const existingOffices = await storage.getAllOffices();
      if (existingOffices.length > 0) {
        return res.status(409).json({ error: "This Host is already set up." });
      }

      const createPayload = {
        ...(req.body || {}),
        settings: withDefaultMessageTemplates((req.body || {}).settings),
      };
      const office = await storage.createOffice(createPayload);
      
      // Assign user as owner
      await storage.updateUser(getAuthUser(req).id, {
        officeId: office.id,
        role: "owner"
      });
      
      res.status(201).json(office);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/offices/:id", requireSameOfficeParam("id"), async (req, res) => {
    try {
      const office = await storage.getOffice(req.params.id);
      if (!office) return res.status(404).json({ error: "Office not found" });
      
      res.json(office);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put(
    "/api/offices/:id",
    requireSameOfficeParam("id"),
    requireRole(["owner", "manager"]),
    async (req, res) => {
    try {
      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const allowedFields = ["name", "address", "phone", "email", "settings"];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(rawBody, field)) {
          updates[field] = (rawBody as any)[field];
        }
      }

      if (Object.prototype.hasOwnProperty.call(updates, "name")) {
        if (typeof updates.name !== "string" || !updates.name.trim()) {
          return res.status(400).json({ error: "Office name is required" });
        }
        updates.name = updates.name.trim();
      }

      for (const key of ["address", "phone", "email"]) {
        if (Object.prototype.hasOwnProperty.call(updates, key) && typeof updates[key] === "string") {
          updates[key] = updates[key].trim();
        }
      }

      if (Object.prototype.hasOwnProperty.call(updates, "settings")) {
        if (!updates.settings || typeof updates.settings !== "object" || Array.isArray(updates.settings)) {
          return res.status(400).json({ error: "settings must be an object" });
        }
        updates.settings = withDefaultMessageTemplates(updates.settings);
      }

      const office = await storage.updateOffice(req.params.id, updates);
      res.json(office);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Team management routes
  app.get("/api/offices/:id/members", requireSameOfficeParam("id"), async (req, res) => {
    try {
      const members = await storage.getUsersInOffice(req.params.id);
      res.json(members.map((member) => withoutPassword(member)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get(
    "/api/offices/:id/join-requests",
    requireSameOfficeParam("id"),
    requireRole(["owner", "manager"]),
    async (req, res) => {
    try {
      const requests = await storage.getJoinRequestsByOffice(req.params.id);
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get(
    "/api/offices/:id/account-requests",
    requireSameOfficeParam("id"),
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        const requests = await storage.getAccountSignupRequestsByOffice(req.params.id);
        res.json(requests);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.post("/api/account-requests", async (req, res) => {
    try {
      const loginId = normalizeLoginId(typeof req.body?.loginId === "string" ? req.body.loginId : "");
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
      const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
      const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
      const requestMessage =
        typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";

      const loginIdError = validateLoginId(loginId);
      if (loginIdError) return res.status(400).json({ error: loginIdError });
      if (!isValidSixDigitPin(pin)) {
        return res.status(400).json({ error: "PIN must be exactly 6 digits." });
      }
      if (!firstName) {
        return res.status(400).json({ error: "First name is required" });
      }
      if (!lastName) {
        return res.status(400).json({ error: "Last name is required" });
      }

      // Password is optional — if provided, validate complexity.
      if (password) {
        const passwordValidation = validatePasswordComplexity(password);
        if (!passwordValidation.valid) {
          return res.status(400).json({
            error: "Password does not meet complexity requirements",
            details: passwordValidation.errors,
          });
        }
      }

      const allOffices = await storage.getAllOffices();
      if (allOffices.length === 0) {
        return res.status(409).json({ error: "This office is not set up yet." });
      }
      if (allOffices.length > 1) {
        return res
          .status(400)
          .json({ error: "Multiple offices exist. Ask your office owner or manager to create your account manually." });
      }

      const office = allOffices[0];

      const existingUser = await storage.getUserByLoginId(loginId);
      if (existingUser) {
        return res.status(409).json({ error: "An account with this Login ID already exists. Please sign in." });
      }

      const pendingRequest = await storage.getPendingAccountSignupRequestByLoginId(office.id, loginId);
      if (pendingRequest) {
        return res.status(409).json({
          error: "A request for this Login ID is already pending review. Ask an owner or manager to approve it.",
        });
      }

      // Keep email storage populated for legacy compatibility, but generate a local-only internal address.
      let internalEmail = buildLocalAuthEmail(loginId, office.id);
      while (await storage.getUserByEmail(internalEmail)) {
        internalEmail = buildLocalAuthEmail(loginId, office.id);
      }

      const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
      const forwardedFor = trustProxy
        ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        : undefined;

      const requestIp = forwardedFor || req.socket.remoteAddress || req.ip || "unknown";
      const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;

      const accountRequest = await storage.createAccountSignupRequest({
        officeId: office.id,
        email: internalEmail,
        loginId,
        passwordHash: password
          ? await hashSecret(password)
          : await hashSecret(randomBytes(32).toString("hex")),
        pinHash: await hashSecret(pin),
        firstName,
        lastName,
        requestedRole: "staff",
        status: "pending",
        requestMessage: requestMessage || null,
        requestedByIp: requestIp || null,
        userAgent,
      });

      const officeUsers = await storage.getUsersInOffice(office.id);
      const approvers = officeUsers.filter((u) => u.role === "owner" || u.role === "manager");
      try {
        await Promise.all(
          approvers.map((approver) =>
            storage.createNotification({
              userId: approver.id,
              actorId: null,
              type: "team_update",
              title: "New account request",
              message: `${firstName} ${lastName} requested access (Login ID: ${loginId}).`,
              metadata: { accountRequestId: accountRequest.id, loginId },
              linkTo: "/dashboard/team",
            }),
          ),
        );
      } catch (notifyError) {
        console.error("Failed to notify approvers about account request:", notifyError);
      }

      broadcastToOffice(office.id, { type: "office_updated", ts: Date.now(), source: "account_request" });

      res.status(202).json({
        ok: true,
        pendingApproval: true,
        message: "Request submitted. An owner or manager must approve your account on the Host.",
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Could not submit account request" });
    }
  });

  app.post(
    "/api/account-requests/:id/approve",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        const role = typeof req.body?.role === "string" ? req.body.role : "staff";
        const allowedRoles = new Set(["manager", "staff", "view_only"]);
        if (!allowedRoles.has(role)) {
          return res.status(400).json({ error: "Invalid role" });
        }
        if (getAuthUser(req).role === "manager" && role === "manager") {
          return res.status(403).json({ error: "Only an Owner can approve another Manager." });
        }

        const requestedRole = role as "manager" | "staff" | "view_only";

        const createdUser = await storage.approveAccountSignupRequest(
          req.params.id,
          getOfficeUser(req).officeId,
          getAuthUser(req).id,
          requestedRole,
        );

        broadcastToOffice(getOfficeUser(req).officeId, { type: "office_updated", ts: Date.now(), source: "account_request" });
        res.status(201).json(withoutPassword(createdUser));
      } catch (error: any) {
        if (String(error?.message || "").toLowerCase().includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.delete(
    "/api/account-requests/:id",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        await storage.rejectAccountSignupRequest(req.params.id, getOfficeUser(req).officeId, getOfficeUser(req).id);
        broadcastToOffice(getOfficeUser(req).officeId, { type: "office_updated", ts: Date.now(), source: "account_request" });
        res.status(204).send();
      } catch (error: any) {
        if (String(error?.message || "").toLowerCase().includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(400).json({ error: error.message });
      }
    },
  );

  // PIN reset request routes
  app.get(
    "/api/offices/:id/pin-reset-requests",
    requireSameOfficeParam("id"),
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        const requests = await storage.getPinResetRequestsByOffice(req.params.id);
        res.json(requests);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.post("/api/pin-reset-requests", async (req, res) => {
    try {
      const loginId = normalizeLoginId(typeof req.body?.loginId === "string" ? req.body.loginId : "");
      const newPin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";

      if (!loginId) {
        return res.status(400).json({ error: "Login ID is required" });
      }
      if (!isValidSixDigitPin(newPin)) {
        return res.status(400).json({ error: "PIN must be exactly 6 digits" });
      }

      // Always return the same response to prevent user enumeration.
      const genericResponse = {
        ok: true,
        message: "If this Login ID exists, a PIN reset request has been submitted for review.",
      };

      const user = await storage.getUserByLoginId(loginId);
      if (!user || !user.officeId) {
        return res.status(202).json(genericResponse);
      }

      const alreadyPending = await storage.getPendingPinResetRequestByUserId(user.id);
      if (alreadyPending) {
        return res.status(202).json({
          ok: true,
          message: "A PIN reset request is already pending review. Please wait for an owner or manager to approve it.",
        });
      }

      const newPinHash = await hashSecret(newPin);
      const created = await storage.createPinResetRequest({
        userId: user.id,
        officeId: user.officeId,
        newPinHash,
      });

      // Notify owners/managers
      const officeUsers = await storage.getUsersInOffice(user.officeId);
      const approvers = officeUsers.filter((u) => u.role === "owner" || u.role === "manager");
      try {
        await Promise.all(
          approvers.map((approver) =>
            storage.createNotification({
              userId: approver.id,
              actorId: null,
              type: "pin_reset",
              title: "PIN reset request",
              message: `${user.firstName} ${user.lastName} (${loginId}) requested a PIN reset.`,
              metadata: { pinResetRequestId: created.id, loginId },
              linkTo: "/dashboard/team",
            }),
          ),
        );
      } catch (notifyError) {
        console.error("Failed to notify approvers about PIN reset request:", notifyError);
      }

      broadcastToOffice(user.officeId, { type: "office_updated", ts: Date.now(), source: "pin_reset_request" });

      res.status(202).json(genericResponse);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Could not submit PIN reset request" });
    }
  });

  app.post(
    "/api/pin-reset-requests/:id/approve",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        await storage.approvePinResetRequest(
          req.params.id,
          getOfficeUser(req).officeId,
          getAuthUser(req).id,
        );

        broadcastToOffice(getOfficeUser(req).officeId, { type: "office_updated", ts: Date.now(), source: "pin_reset_request" });
        res.status(200).json({ ok: true });
      } catch (error: any) {
        if (String(error?.message || "").toLowerCase().includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.delete(
    "/api/pin-reset-requests/:id",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        await storage.rejectPinResetRequest(
          req.params.id,
          getOfficeUser(req).officeId,
          getAuthUser(req).id,
        );

        broadcastToOffice(getOfficeUser(req).officeId, { type: "office_updated", ts: Date.now(), source: "pin_reset_request" });
        res.status(204).send();
      } catch (error: any) {
        if (String(error?.message || "").toLowerCase().includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(400).json({ error: error.message });
      }
    },
  );

  // User management routes
  app.put("/api/users/:id", requireOffice, requireRole(["owner", "manager"]), async (req, res) => {
    try {
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser || targetUser.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "User not found" });
      }

      // Avoid self-edits through this endpoint (UI already blocks it).
      if (targetUser.id === getAuthUser(req).id) {
        return res.status(400).json({ error: "You can’t update your own role here." });
      }

      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const roleInput = Object.prototype.hasOwnProperty.call(rawBody, "role") ? (rawBody as any).role : undefined;
      const officeIdInput = Object.prototype.hasOwnProperty.call(rawBody, "officeId") ? (rawBody as any).officeId : undefined;

      const updates: Record<string, any> = {};

      if (roleInput !== undefined) {
        if (typeof roleInput !== "string") {
          return res.status(400).json({ error: "Invalid role" });
        }

        const allowedRoles = new Set(["owner", "manager", "staff", "view_only"]);
        if (!allowedRoles.has(roleInput)) {
          return res.status(400).json({ error: "Invalid role" });
        }

        updates.role = roleInput;
      }

      if (officeIdInput !== undefined) {
        // Only support removing a user from the current office.
        if (officeIdInput !== null) {
          return res.status(400).json({ error: "Invalid officeId" });
        }
        updates.officeId = null;
        // Normalize role when removing.
        updates.role = "staff";
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No changes provided" });
      }

      const actingRole = getAuthUser(req).role;
      if (actingRole === "manager") {
        // Managers can manage staff/view-only users only.
        if (targetUser.role === "owner" || targetUser.role === "manager") {
          return res.status(403).json({ error: "Only an Owner can manage this user." });
        }
        if (updates.role && (updates.role === "owner" || updates.role === "manager")) {
          return res.status(403).json({ error: "Only an Owner can assign that role." });
        }
      }

      // Prevent removing/demoting the last owner.
      const isRemoving = Object.prototype.hasOwnProperty.call(updates, "officeId") && updates.officeId === null;
      const roleChangingAwayFromOwner = updates.role && targetUser.role === "owner" && updates.role !== "owner";
      if (targetUser.role === "owner" && (isRemoving || roleChangingAwayFromOwner)) {
        const members = await storage.getUsersInOffice(getOfficeUser(req).officeId);
        const ownerCount = members.filter((u) => u.role === "owner").length;
        if (ownerCount <= 1) {
          return res.status(400).json({ error: "You can’t remove the last Owner from the office." });
        }
      }

      const updated = await storage.updateUser(targetUser.id, updates);
      res.json(withoutPassword(updated));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Join request routes
  app.post("/api/join-requests", requireAuth, async (req, res) => {
    try {
      if (getAuthUser(req).officeId) {
        return res.status(400).json({ error: "You already belong to an office." });
      }

      const { ownerEmail, message } = req.body;
      
      // Find the owner and their office
      const owner = await storage.getUserByEmail(ownerEmail);
      if (!owner || !owner.officeId || owner.role !== 'owner') {
        return res.status(400).json({ error: "Owner not found" });
      }
      
      const request = await storage.createJoinRequest(getAuthUser(req).id, owner.officeId, message);
      res.status(201).json(request);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post(
    "/api/join-requests/:id/approve",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
    try {
      const pending = await storage.getJoinRequestsByOffice(getOfficeUser(req).officeId);
      const request = pending.find((r: any) => r.id === req.params.id);
      if (!request) {
        return res.status(404).json({ error: "Join request not found" });
      }

      const role = typeof req.body?.role === "string" ? req.body.role : "";
      const allowedRoles = new Set(["manager", "staff", "view_only"]);
      if (!allowedRoles.has(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      await storage.approveJoinRequest(req.params.id, role);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(
    "/api/join-requests/:id",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
    try {
      const pending = await storage.getJoinRequestsByOffice(getOfficeUser(req).officeId);
      const request = pending.find((r: any) => r.id === req.params.id);
      if (!request) {
        return res.status(404).json({ error: "Join request not found" });
      }

      await storage.rejectJoinRequest(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Invitation routes
  app.post("/api/invitations", requireOffice, requireRole(["owner"]), async (req, res) => {
    try {
      const invitationData = insertInvitationSchema.parse({
        ...req.body,
        officeId: getAuthUser(req).officeId,
        invitedBy: getAuthUser(req).id,
      });
      
      // Generate a unique token
      const { nanoid } = await import('nanoid');
      const token = nanoid(32);
      
      // Set expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      const invitation = await storage.createInvitation({
        ...invitationData,
        token,
        expiresAt,
      });
      
      res.status(201).json(invitation);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/invitations", requireOffice, async (req, res) => {
    try {
      const invitations = await storage.getInvitationsByOffice(getOfficeUser(req).officeId);
      res.json(invitations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/invitations/:id", requireOffice, requireRole(["owner"]), async (req, res) => {
    try {
      // Verify user is owner and invitation belongs to their office
      const invitation = await storage.getInvitationById(req.params.id);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }
      
      if (invitation.officeId !== getAuthUser(req).officeId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.cancelInvitation(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/invitations/verify/:token", async (req, res) => {
    try {
      const invitation = await storage.getInvitationByToken(req.params.token);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: "Invitation already used" });
      }
      if (new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Invitation expired" });
      }

      const office = await storage.getOffice(invitation.officeId);
      const inviter = await storage.getUser(invitation.invitedBy);

      res.json({
        email: invitation.email,
        role: invitation.role,
        message: invitation.message,
        officeId: invitation.officeId,
        officeName: office?.name || 'Unknown Office',
        inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Unknown',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invitations/accept/:token", requireAuth, async (req, res) => {
    try {
      if (getAuthUser(req).officeId) {
        return res.status(400).json({ error: "You already belong to an office." });
      }

      await storage.acceptInvitation(req.params.token, getAuthUser(req).id);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Notification rules routes
  app.get("/api/notification-rules", requireOffice, async (req, res) => {
    try {
      const rules = await storage.getNotificationRulesByOffice(getOfficeUser(req).officeId);
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notification-rules", requireOffice, requireRole(["owner", "manager"]), async (req, res) => {
    try {
      const ruleData = insertNotificationRuleSchema.parse({
        ...req.body,
        officeId: getAuthUser(req).officeId
      });
      
      const rule = await storage.createNotificationRule(ruleData);
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/notification-rules/:id", requireOffice, requireRole(["owner", "manager"]), async (req, res) => {
    try {
      // Verify rule belongs to user's office
      const existingRule = await storage.getNotificationRule(req.params.id);
      if (!existingRule || existingRule.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Notification rule not found" });
      }
      
      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const allowedFields = ["status", "maxDays", "enabled", "smsEnabled", "smsTemplate", "notifyRoles", "notifyUsers"];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(rawBody, field)) {
          updates[field] = (rawBody as any)[field];
        }
      }

      if (Object.prototype.hasOwnProperty.call(updates, "status")) {
        if (typeof updates.status !== "string" || !updates.status.trim()) {
          return res.status(400).json({ error: "status is required" });
        }
        updates.status = updates.status.trim();
      }
      if (Object.prototype.hasOwnProperty.call(updates, "smsTemplate") && typeof updates.smsTemplate === "string") {
        updates.smsTemplate = updates.smsTemplate.trim();
      }

      const rule = await storage.updateNotificationRule(req.params.id, updates);
      res.json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/notification-rules/:id", requireOffice, requireRole(["owner", "manager"]), async (req, res) => {
    try {
      // Verify rule belongs to user's office
      const existingRule = await storage.getNotificationRule(req.params.id);
      if (!existingRule || existingRule.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Notification rule not found" });
      }
      
      await storage.deleteNotificationRule(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Analytics routes
  app.get("/api/analytics/metrics", requireOffice, async (req, res) => {
    try {
      const { startDate, endDate, jobType } = req.query;
      
      // Get active jobs
      const activeJobs = await storage.getJobsByOffice(getOfficeUser(req).officeId);
      
      // Get archived jobs
      const archivedJobs = await storage.getArchivedJobsByOffice(getOfficeUser(req).officeId);
      
      // Filter by date range and job type if provided
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      
      const filteredArchived = archivedJobs.filter(job => {
        const jobDate = new Date(job.archivedAt);
        const inDateRange = jobDate >= start && jobDate <= end;
        const matchesType = !jobType || jobType === 'all' || job.jobType === jobType;
        return inDateRange && matchesType;
      });
      
      const filteredActive = activeJobs.filter(job => {
        const jobDate = new Date(job.statusChangedAt || job.createdAt);
        const inDateRange = jobDate >= start && jobDate <= end;
        const matchesType = !jobType || jobType === 'all' || job.jobType === jobType;
        return inDateRange && matchesType;
      });
      
      // Calculate metrics
      const completed = filteredArchived.filter(j => j.finalStatus === 'completed').length +
                       filteredActive.filter(j => j.status === 'completed').length;
      const cancelled = filteredArchived.filter(j => j.finalStatus === 'cancelled').length +
                       filteredActive.filter(j => j.status === 'cancelled').length;
      const active = filteredActive.filter(j => j.status !== 'completed' && j.status !== 'cancelled').length;
      
      // Calculate average completion time
      const completedWithTime = filteredArchived
        .filter(j => j.finalStatus === 'completed' && j.originalCreatedAt && j.archivedAt)
        .map(j => {
          const created = new Date(j.originalCreatedAt);
          const archived = new Date(j.archivedAt);
          return (archived.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        });
      
      const avgCompletionTime = completedWithTime.length > 0
        ? (completedWithTime.reduce((a, b) => a + b, 0) / completedWithTime.length).toFixed(1)
        : null;
      
      res.json({
        active,
        completed,
        cancelled,
        avgCompletionTime,
        totalJobs: active + completed + cancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin routes
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/offices", requireAdmin, async (req, res) => {
    try {
      const offices = await storage.getAllOffices();
      res.json(offices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/offices/:id", requireAdmin, async (req, res) => {
    try {
      const officeWithMetrics = await storage.getOfficeWithMetrics(req.params.id);
      if (!officeWithMetrics) {
        return res.status(404).json({ error: "Office not found" });
      }
      res.json(officeWithMetrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/offices/:id/status", requireAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }

      const office = await storage.toggleOfficeStatus(req.params.id, enabled);
      
      await storage.createAuditLog({
        adminId: getAuthUser(req).id,
        action: enabled ? 'enable_office' : 'disable_office',
        targetType: 'office',
        targetId: req.params.id,
        metadata: { officeName: office.name, enabled }
      });

      res.json(office);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/activity", requireAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const activity = await storage.getAdminActivity(limit);
      res.json(activity);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/audit", requireAdmin, async (req, res) => {
    try {
      const auditData = insertAdminAuditLogSchema.parse({
        ...req.body,
        adminId: getAuthUser(req).id
      });
      
      const log = await storage.createAuditLog(auditData);
      res.status(201).json(log);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Error log routes (admin only)
  app.get("/api/admin/errors", requireAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const errors = getRecentErrors(limit);
      res.json(errors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/errors/stats", requireAdmin, async (req, res) => {
    try {
      const stats = getErrorStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/errors", requireAdmin, async (req, res) => {
    try {
      clearErrors();
      res.json({ message: "Error logs cleared" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Notification routes
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const notifications = await storage.getNotificationsByUser(getAuthUser(req).id, {
        unreadOnly,
        limit,
        offset
      });

      res.json(notifications);
    } catch (error: any) {
      console.error("GET /api/notifications - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/notifications/unread-count", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const count = await storage.getUnreadNotificationCount(getAuthUser(req).id);
      res.json({ count });
    } catch (error: any) {
      console.error("GET /api/notifications/unread-count - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const notification = await storage.markNotificationRead(req.params.id, getAuthUser(req).id);
      res.json(notification);
    } catch (error: any) {
      console.error("PATCH /api/notifications/:id/read - Error:", error.message);
      if (error.message.includes("not found") || error.message.includes("Not authorized")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.patch("/api/notifications/read-all", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      await storage.markAllNotificationsRead(getAuthUser(req).id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("PATCH /api/notifications/read-all - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/notifications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      await storage.deleteNotification(req.params.id, getAuthUser(req).id);
      res.status(204).send();
    } catch (error: any) {
      console.error("DELETE /api/notifications/:id - Error:", error.message);
      if (error.message.includes("not found") || error.message.includes("Not authorized")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // SMS routes
  app.post("/api/sms/opt-in", async (req, res) => {
    try {
      const { phone, officeId } = req.body;
      
      const optInData = insertSmsOptInSchema.parse({
        phone,
        officeId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        sourceUrl: req.get('Referer')
      });
      
      const optIn = await storage.createSmsOptIn(optInData);
      res.status(201).json(optIn);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/sms/send", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { phone, message, jobId } = req.body;

      if (!phone || typeof phone !== "string") {
        return res.status(400).json({ error: "phone is required" });
      }

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "message is required" });
      }

      if (jobId && typeof jobId === "string") {
        const job = await storage.getJob(jobId);
        if (!job || job.officeId !== getAuthUser(req).officeId) {
          return res.status(404).json({ error: "Job not found" });
        }
      }
      
      // Check if patient has opted in
      const optIn = await storage.getSmsOptIn(phone, getOfficeUser(req).officeId);
      if (!optIn) {
        return res.status(400).json({ error: "Patient has not opted in to SMS notifications" });
      }
      
      // Send SMS
      const result = await sendSMS(phone, message.trim());
      
      // Log the attempt
      await storage.logSms({
        jobId: jobId || null,
        phone,
        message: message.trim(),
        status: result.success ? 'sent' : 'failed',
        messageSid: result.messageSid,
        errorCode: result.errorCode,
        errorMessage: result.error
      });
      
      if (result.success) {
        res.json({ success: true, messageSid: result.messageSid });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const server = createAppServer(app);
  return { server, sessionMiddleware };
}
