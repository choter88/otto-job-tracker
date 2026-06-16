import type { Express, Request, Response } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer as createHttpServer, type Server as HttpServer } from "http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "https";
import { createHash, randomBytes, randomUUID } from "crypto";
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
  jobLinkGroups,
  linkGroupNotes,
  clientDevices as clientDevicesTable,
  usageEvents,
  insertJobSchema,
  insertJobCommentSchema,
  insertNotificationRuleSchema,
  insertInvitationSchema,
  insertSmsOptInSchema,
  insertAdminAuditLogSchema,
} from "@shared/schema";
import { sendSMS } from "./twilioClient";
import { requireAdmin, requireAuth, requireNotViewOnly, requireOffice, requireRole, requireSameOfficeParam } from "./middleware";
import { notifyJobStatusChange, notifyNewComment, notifyOverdueJob, notifyJobStarred, notifyJobAutoCreated } from "./notification-service";
import {
  generateJobSummary,
  checkAndRegenerateSummary,
  isAiSummaryEnabled,
} from "./ai-summary-service";
import { getRecentErrors, getErrorStats, clearErrors } from "./error-logger";
import { db, sqlite } from "./db";
import { and, desc, eq, sql } from "drizzle-orm";
import { hashSecret } from "./secret-hash";
import { activateHostWithPortalToken, forceCheckin, getHostToken, getLicenseSnapshot } from "./license";
import {
  portalGetInviteCode,
  portalRegenerateInviteCode,
  portalDesktopAuth,
  portalSubmitFeedback,
  portalCreateTrackingLink,
  portalUpdateTrackingLink,
  portalRevokeTrackingLink,
  portalListTrackingLinks,
  portalAppendTrackingEvent,
  portalGetTrackingLabelChoices,
  portalUpdateTrackingLabelChoices,
  portalRevokeClientRecovery,
  portalGetFeatureFlags,
  getLicenseBaseUrl,
  type TrackingLinkRecord,
} from "./license-client";
import { scanNotesForPhi } from "./tracking-link-phi-scan";
import { mapStatusToEnum, PATIENT_STATUS_VALUES, type PatientStatus } from "@shared/patient-status-enum";
import { trackingLinkNotesLocal, trackingLinkVisibilityLocal } from "@shared/schema";
import { importSnapshotV1 } from "./migration-import";
import { normalizePatientNamePart } from "@shared/name-format";
import { getAllTemplates, createUserTemplate, updateUserTemplate, deleteUserTemplate } from "./import-templates";
import { parseCsvFile, executeImport } from "./import-csv";
import { z } from "zod";
import { computeMissingOrderSheetFields, parseOrderSheet, type OrderSheetOption } from "@shared/order-sheet-parser";
import { mergeLearnedFields } from "@shared/order-sheet-layout";
import {
  applyLearnedOrderSheetTemplates,
  extractOrderSheetLayoutFromPdf,
  learnFromOrderSheetCorrection,
} from "./order-sheet-learning";
import { deriveDeviceAutoLabel } from "./device-label";
import { ensureReadyForPickupTemplate } from "@shared/message-template-defaults";
import { defaultOnboardingForNewOffice } from "@shared/onboarding";
import { getDefaultOfficeSettings } from "@shared/office-defaults";
import { sortVisibleStatusesByOffice } from "@shared/tracking-link-defaults";
import { broadcastToOffice, getConnectedClientCount, getOfficeClientPresence } from "./sync-websocket";
import { trackEvent, CLIENT_TRACKABLE_EVENTS, getAggregatedDailyStats, getRawEventsSince } from "./usage-tracker";
import { buildLocalAuthEmail, isValidSixDigitPin, normalizeLoginId, validateLoginId } from "./auth-identifiers";
import { registerTabletRoutes } from "./tablet-routes";
import { invalidateTabletSessionsForUser } from "./tablet-auth";
import type { User } from "@shared/schema";

// ── Tablet session tracking (delegated to tablet-auth module) ──
export { getActiveTabletSessionCount } from "./tablet-auth";

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
  entityType: 'job' | 'comment' | 'archived_job' | 'patient_list' | 'order_sheet_import' | 'job_attachment',
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

// Insert an order-sheet ledger row, treating the (office, hash) unique
// index as a claim: when two computers ingest the same file at the same
// moment, exactly one insert wins; the loser gets the winner's row back
// with claimed=false and must not create a job.
async function claimOrderSheetRecord(
  officeId: string,
  contentHash: string,
  record: Parameters<typeof storage.createOrderSheetImport>[0],
): Promise<{ claimed: boolean; record: Awaited<ReturnType<typeof storage.createOrderSheetImport>> }> {
  try {
    return { claimed: true, record: await storage.createOrderSheetImport(record) };
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.includes("order_sheet_imports_office_hash_unique") || msg.includes("UNIQUE constraint failed: order_sheet_imports")) {
      const existing = await storage.getOrderSheetImportByHash(officeId, contentHash);
      if (existing) return { claimed: false, record: existing };
    }
    throw error;
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

// Mutex to prevent concurrent bootstrap requests (Part 1.3 fix)
let setupBootstrapInProgress = false;

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

  if (status === 402 || code === "SUBSCRIPTION_REQUIRED") {
    return {
      status: 402,
      message: "Your subscription is not active. Visit ottojobtracker.com/portal/billing to update your plan.",
      code: "SUBSCRIPTION_REQUIRED",
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
      message: "Host setup requires internet access. Check your connection and try again.",
      code: "REQUEST_FAILED",
    };
  }

  if (status >= 400 && status < 500) {
    return {
      status,
      message: rawMessage || "Activation was not accepted. Please try again or contact support.",
      code: "REQUEST_FAILED",
    };
  }

  return {
    status: 500,
    message: rawMessage || "Host activation failed.",
    code: "REQUEST_FAILED",
  };
}

export function registerRoutes(app: Express): { server: AppServer; sessionMiddleware: any } {
  // Setup authentication
  const sessionMiddleware = setupAuth(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // ── User preferences ────────────────────────────────────────────────
  app.get("/api/user/preferences", requireAuth, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const row = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, user.id)).limit(1);
      const prefs = row[0]?.preferences ?? {};
      res.json(typeof prefs === "string" ? JSON.parse(prefs) : prefs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/user/preferences", requireAuth, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const incoming = req.body;
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        return res.status(400).json({ error: "Body must be a JSON object" });
      }
      const row = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, user.id)).limit(1);
      const existing = row[0]?.preferences ?? {};
      const current = typeof existing === "string" ? JSON.parse(existing) : existing;
      const merged = { ...current, ...incoming };
      await db.update(users).set({ preferences: merged, updatedAt: new Date() }).where(eq(users.id, user.id));
      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/license/status", (_req, res) => {
    applyNoStoreHeaders(res);
    const snapshot = getLicenseSnapshot();
    // Include the portal billing URL so the UI can deep-link directly to checkout.
    const portalBase = getLicenseBaseUrl().toString().replace(/\/$/, "");
    res.json({
      ...snapshot,
      portalBillingUrl: `${portalBase}/portal/billing?autocheckout=1`,
    });
  });

  // ── Analytics diagnostic endpoint ──
  app.get("/api/analytics/debug", (_req, res) => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const dailyStats = getAggregatedDailyStats(sevenDaysAgo);
      const rawEvents = getRawEventsSince(sevenDaysAgo);
      const totalEventsInDb = db.select({ count: sql`count(*)` }).from(usageEvents).all();
      res.json({
        totalEventsInDb: totalEventsInDb[0]?.count ?? 0,
        dailyStats,
        rawEventsCount: rawEvents.length,
        hostToken: getHostToken() ? "present" : "MISSING",
        lastCheckinAt: getLicenseSnapshot().lastSuccessfulCheckinAt,
      });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ── Usage event tracking (client-side tab navigation, search, etc.) ──
  app.post("/api/track", (req, res) => {
    const eventType = typeof req.body?.eventType === "string" ? req.body.eventType : "";
    if (!CLIENT_TRACKABLE_EVENTS.has(eventType)) {
      return res.status(400).json({ error: "Invalid event type" });
    }
    const userId = getAuthUser(req)?.id ?? null;
    const officeId = getOfficeUser(req)?.officeId ?? null;
    trackEvent({ userId, officeId, eventType });
    res.status(204).end();
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

  // ── Invite code management (Host/owner only) ──────────────────────
  app.get("/api/invite-code", requireAuth, requireRole(["owner"]), async (_req, res) => {
    applyNoStoreHeaders(res);
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(404).json({ error: "Host is not activated" });
    }
    try {
      const result = await portalGetInviteCode({ hostToken });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message });
      }
      res.json({ inviteCode: result.inviteCode, expiresAt: result.expiresAt });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get invite code" });
    }
  });

  app.post("/api/invite-code/regenerate", requireAuth, requireRole(["owner"]), async (_req, res) => {
    applyNoStoreHeaders(res);
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(404).json({ error: "Host is not activated" });
    }
    try {
      const result = await portalRegenerateInviteCode({ hostToken });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message });
      }
      res.json({ inviteCode: result.inviteCode, expiresAt: result.expiresAt });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to regenerate invite code" });
    }
  });

  // ── Feedback submission (proxied to portal) ──
  app.post("/api/feedback", requireAuth, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(503).json({ error: "Host is not activated" });
    }
    try {
      const { category, message } = req.body;
      if (!category || typeof category !== "string") {
        return res.status(400).json({ error: "category is required" });
      }
      if (!message || typeof message !== "string" || message.trim().length < 10) {
        return res.status(400).json({ error: "message must be at least 10 characters" });
      }
      const result = await portalSubmitFeedback({
        hostToken,
        category,
        message: message.trim(),
        appVersion: process.env.OTTO_APP_VERSION || process.env.npm_package_version || undefined,
        platform: process.platform,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message });
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to submit feedback" });
    }
  });

  // ── Patient tracking links (proxied to portal, host-token-authenticated) ──
  //
  // The desktop holds all patient/order data locally. The portal stores
  // only an opaque token, opaque job UUIDs for coverage, and an
  // append-only (status enum, occurred_at) event log.
  //
  // Status translation: every status change that we want patients to
  // see is mapped via mapStatusToEnum() BEFORE the desktop emits an
  // event. Unmappable statuses (office-custom IDs without a configured
  // enum mapping) are dropped silently — they never reach the portal.
  //
  // Notes: the staff still authors per-link notes in the worklist UI.
  // They are written to a local SQLite table and rendered in the
  // desktop UI from there. They never leave this host.

  /**
   * Resolve local jobs by ID, scoped to the caller's office. Returns the
   * jobs and any IDs that didn't match (callers fail-fast if any miss).
   */
  async function loadLocalJobsForOffice(jobIds: string[], officeId: string): Promise<{
    jobs: typeof jobs.$inferSelect[];
    missing: string[];
  }> {
    if (jobIds.length === 0) return { jobs: [], missing: [] };
    const rows = await db.select().from(jobs).where(
      and(
        eq(jobs.officeId, officeId),
        sql`${jobs.id} IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
    const found = new Set(rows.map((r) => r.id));
    return { jobs: rows, missing: jobIds.filter((id) => !found.has(id)) };
  }

  /**
   * Read the office's per-status enum mapping override (settings.
   * trackingLinkDefaults.statusEnumMapping), used by mapStatusToEnum
   * to translate office-custom status IDs onto the canonical enum.
   */
  async function getOfficeStatusEnumMapping(officeId: string): Promise<Record<string, string> | undefined> {
    const office = await storage.getOffice(officeId);
    const tld = ((office?.settings as any)?.trackingLinkDefaults ?? {}) as { statusEnumMapping?: unknown };
    if (!tld.statusEnumMapping || typeof tld.statusEnumMapping !== "object") return undefined;
    return tld.statusEnumMapping as Record<string, string>;
  }

  /**
   * Load the per-link visibility set as a Set of canonical enum values.
   * If no rows exist (never configured), returns null to signal "no
   * restriction" — callers treat this as "emit everything" for
   * backward compat. Once a link has any visibility row, the absence
   * of a row for a given status means "hide".
   */
  async function getLinkVisibility(linkToken: string): Promise<Set<PatientStatus> | null> {
    const rows = await db.select({ status: trackingLinkVisibilityLocal.status })
      .from(trackingLinkVisibilityLocal)
      .where(eq(trackingLinkVisibilityLocal.linkToken, linkToken));
    if (rows.length === 0) return null;
    return new Set(
      rows
        .map((r) => r.status)
        .filter((s): s is PatientStatus => (PATIENT_STATUS_VALUES as readonly string[]).includes(s)),
    );
  }

  /** Replace a link's visibility set wholesale. */
  async function setLinkVisibility(linkToken: string, statuses: PatientStatus[]) {
    await db.delete(trackingLinkVisibilityLocal)
      .where(eq(trackingLinkVisibilityLocal.linkToken, linkToken));
    if (statuses.length === 0) return;
    await db.insert(trackingLinkVisibilityLocal).values(
      statuses.map((status) => ({ linkToken, status })),
    );
  }

  /**
   * Resolve the default visibility set for a new link covering the given
   * job types. Honors the office's per-job-type overrides + global
   * defaults from settings.trackingLinkDefaults. Returns the canonical
   * enum subset — the office's internal status IDs are mapped through
   * statusEnumMapping before being returned.
   */
  async function resolveDefaultVisibilityForJobTypes(
    officeId: string,
    jobTypes: string[],
  ): Promise<PatientStatus[]> {
    const office = await storage.getOffice(officeId);
    const settings = (office?.settings || {}) as any;
    const tld = settings.trackingLinkDefaults || {};
    const mapping = (tld.statusEnumMapping || {}) as Record<string, string>;
    const globalDefault: string[] = Array.isArray(tld.visibleStatuses) && tld.visibleStatuses.length > 0
      ? tld.visibleStatuses
      : ["ordered", "in_progress", "ready_for_pickup"];
    const byJobType = (tld.byJobType && typeof tld.byJobType === "object") ? tld.byJobType : {};

    // Union of every covered type's visible-status set, then map to enum.
    const internal = new Set<string>();
    for (const t of jobTypes) {
      const list = Array.isArray(byJobType[t]?.visibleStatuses) && byJobType[t].visibleStatuses.length > 0
        ? byJobType[t].visibleStatuses
        : globalDefault;
      for (const s of list) internal.add(s);
    }

    const enumSet = new Set<PatientStatus>();
    for (const s of Array.from(internal)) {
      const mapped = mapStatusToEnum(s, mapping);
      if (mapped) enumSet.add(mapped);
    }
    // If no statuses survive the enum mapping, fall back to a sensible
    // default so the patient page isn't blank.
    if (enumSet.size === 0) {
      return ["received", "sent_to_lab", "in_progress", "ready_for_pickup"];
    }
    return Array.from(enumSet);
  }

  /**
   * Fan out a status event to every active tracking link covering the
   * given job, gating per-link by the office's stored visibility. Does
   * a single portal list call to discover coverage, then per-link
   * visibility checks + targeted appendEvent calls. Each call is
   * fire-and-forget; a flaky portal must not block the local status
   * change.
   */
  async function emitStatusEventForJob(args: {
    hostToken: string;
    jobId: string;
    status: PatientStatus;
    occurredAt: string;
  }) {
    const list = await portalListTrackingLinks({ hostToken: args.hostToken, jobIds: [args.jobId] });
    if (!list.ok) return;
    for (const link of list.links) {
      if (link.revokedAt) continue;
      const visibility = await getLinkVisibility(link.token);
      if (visibility !== null && !visibility.has(args.status)) continue;
      portalAppendTrackingEvent({
        hostToken: args.hostToken,
        linkId: link.id,
        status: args.status,
        occurredAt: args.occurredAt,
      }).catch((err) => console.error("[tracking-links] event emit failed:", err?.message || err));
    }
  }

  /**
   * Backfill a freshly-created (or just-merged) link with one event per
   * historical status change across the given jobs. Each historical
   * status is mapped through the office's enum mapping; unmappable
   * values are dropped. Events are filtered against the link's local
   * visibility set, then sent to the portal targeted at this specific
   * link (so a job covered by multiple links doesn't get
   * cross-pollinated). Idempotent on the portal side.
   */
  async function backfillEventsForLink(
    jobRows: typeof jobs.$inferSelect[],
    hostToken: string,
    officeMapping: Record<string, string> | undefined,
    link: { id: string; token: string },
  ): Promise<void> {
    if (jobRows.length === 0) return;
    const ids = jobRows.map((j) => j.id);
    const histories = await db.select({
      jobId: jobStatusHistory.jobId,
      newStatus: jobStatusHistory.newStatus,
      changedAt: jobStatusHistory.changedAt,
    })
      .from(jobStatusHistory)
      .where(sql`${jobStatusHistory.jobId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
      .orderBy(jobStatusHistory.changedAt);

    // Take the EARLIEST occurrence of each enum value across all jobs
    // covered by the link — the patient sees one ordered timeline, not
    // a per-job stream. Matches the portal's cleanup-script logic.
    const earliest = new Map<PatientStatus, Date>();
    const consider = (rawStatus: string, atIso: string | Date) => {
      const mapped = mapStatusToEnum(rawStatus, officeMapping);
      if (!mapped) return;
      const at = atIso instanceof Date ? atIso : new Date(atIso);
      if (Number.isNaN(at.getTime())) return;
      const existing = earliest.get(mapped);
      if (!existing || at.getTime() < existing.getTime()) earliest.set(mapped, at);
    };
    for (const h of histories) consider(h.newStatus, new Date(h.changedAt));
    for (const j of jobRows) consider(j.status, new Date(j.statusChangedAt));

    const visibility = await getLinkVisibility(link.token);
    const earliestEntries = Array.from(earliest.entries());
    for (const [status, occurredAt] of earliestEntries) {
      if (visibility !== null && !visibility.has(status)) continue;
      portalAppendTrackingEvent({
        hostToken,
        linkId: link.id,
        status,
        occurredAt: occurredAt.toISOString(),
      }).catch((err) => console.error("[tracking-links] backfill failed:", err?.message || err));
    }
  }

  /**
   * Auto-generate (or merge into) a tracking link for a newly-created
   * job. The single source of truth for the auto-gen flow, called from
   * both `POST /api/jobs` and the CSV import route so EHR-imported jobs
   * get the same behavior as dialog-created ones.
   *
   * Merge rule — CONSERVATIVE: a new job's snapshot is only appended to
   * an existing link when the staff has EXPLICITLY manually linked
   * this job with a sibling via `job_link_groups` (the worklist's
   * Link feature). Name match alone is not sufficient — two unrelated
   * "John Smith"s in the same office must never end up sharing one
   * patient-facing link, even if both have active tracking links.
   *
   * For the "create glasses then create sunglasses for the same
   * patient" workflow: each job gets its own link by default. Staff
   * consolidates by manually linking the two jobs from the worklist
   * (existing feature) — that flow now extends a single tracking link
   * across the group (see the merge logic in `POST /api/jobs/link`).
   *
   * Returns the link URL on success; null on any failure. Never throws —
   * callers should treat a null URL as "auto-gen failed, job creation
   * still succeeded" rather than rolling anything back.
   */
  async function autoGenerateOrMergeTrackingLinkForJob(
    newJob: typeof jobs.$inferSelect,
    hostToken: string,
  ): Promise<{ url: string | null; merged: boolean }> {
    try {
      const officeMapping = await getOfficeStatusEnumMapping(newJob.officeId);

      // Look for a manual link group involving this job. The auto-gen
      // path runs in the same request that just inserted the job, so
      // we're really only catching the case where staff is linking
      // jobs together as a deliberate flow (rare on initial creation,
      // common for the post-link consolidation triggered from
      // `POST /api/jobs/link`, which calls this function indirectly).
      const groupEntry = await db
        .select({ groupId: jobLinkGroups.groupId })
        .from(jobLinkGroups)
        .where(eq(jobLinkGroups.jobId, newJob.id))
        .limit(1);

      if (groupEntry.length > 0) {
        const target = await findMergeTargetForGroup(
          groupEntry[0].groupId,
          newJob.id,
          hostToken,
        );
        if (target) {
          const mergedIds = Array.from(new Set([...target.jobIds, newJob.id]));
          // Portal caps a link at 10 jobs — fall through to a new
          // link if the merge would exceed that.
          if (mergedIds.length <= 10) {
            const { jobs: mergedJobs, missing } = await loadLocalJobsForOffice(
              mergedIds,
              newJob.officeId,
            );
            if (missing.length === 0) {
              const result = await portalUpdateTrackingLink({
                hostToken,
                id: target.id,
                jobIds: mergedIds,
              });
              if (result.ok) {
                // The newly-added job needs its history backfilled as
                // events on the (now expanded) link. Existing
                // visibility on the merge target governs which events
                // actually reach the portal.
                await backfillEventsForLink([newJob], hostToken, officeMapping, { id: target.id, token: target.token });
                return { url: result.link.url, merged: true };
              }
            }
          }
        }
      }

      // No manual-link-group merge candidate — create a fresh link.
      // Seed per-link visibility from the office's per-job-type defaults
      // so subsequent backfills + status pushes respect what staff has
      // configured for this job type. Initial event is the current
      // status mapped to the enum, gated by visibility so a hidden
      // initial step doesn't sneak through.
      const defaultVis = await resolveDefaultVisibilityForJobTypes(newJob.officeId, [newJob.jobType]);
      const initialEnum = mapStatusToEnum(newJob.status, officeMapping);
      const initialPasses = initialEnum && defaultVis.includes(initialEnum);
      const result = await portalCreateTrackingLink({
        hostToken,
        jobIds: [newJob.id],
        initialStatus: initialPasses ? initialEnum : undefined,
        initialStatusAt: initialPasses ? new Date(newJob.statusChangedAt).toISOString() : undefined,
      });
      if (result.ok) {
        await setLinkVisibility(result.link.token, defaultVis);
        await backfillEventsForLink([newJob], hostToken, officeMapping, { id: result.link.id, token: result.link.token });
        return { url: result.link.url, merged: false };
      }
      return { url: null, merged: false };
    } catch (err: any) {
      console.error("[tracking-links] auto-generate failed:", err?.message || err);
      return { url: null, merged: false };
    }
  }

  /**
   * Find the best existing tracking link to merge into, scoped to a
   * single manual link group. Returns the most recently created
   * un-revoked link covering any sibling in the group, or null if
   * there isn't one.
   */
  async function findMergeTargetForGroup(
    groupId: string,
    excludeJobId: string,
    hostToken: string,
  ): Promise<TrackingLinkRecord | null> {
    const siblings = await db
      .select({ jobId: jobLinkGroups.jobId })
      .from(jobLinkGroups)
      .where(
        and(
          eq(jobLinkGroups.groupId, groupId),
          sql`${jobLinkGroups.jobId} != ${excludeJobId}`,
        ),
      );
    const siblingIds = siblings.map((s) => s.jobId);
    if (siblingIds.length === 0) return null;

    const listResult = await portalListTrackingLinks({ hostToken, jobIds: siblingIds });
    if (!listResult.ok) return null;

    const active = listResult.links.filter((l) => l.revokedAt === null);
    if (active.length === 0) return null;
    active.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return active[0];
  }

  app.post("/api/tracking-links", requireAuth, requireNotViewOnly, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(503).json({ error: "Host is not activated" });
    }
    const user = getOfficeUser(req);
    // `visibleStatuses`, `eta`, `customNotes` are still accepted from
    // older UI callers but no longer sent to the portal. ETA stays
    // local (the SMS template can render it). The note (if any) is
    // PHI-scanned and stored locally — never sent upstream.
    const { jobIds, eta, customNotes, expiresAt } = req.body || {};
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: "jobIds must be a non-empty array" });
    }
    if (jobIds.length > 10) {
      return res.status(400).json({ error: "Tracking links can cover at most 10 jobs." });
    }
    try {
      const { jobs: localJobs, missing } = await loadLocalJobsForOffice(jobIds, user.officeId);
      if (missing.length > 0) {
        return res.status(404).json({ error: "Some of the selected jobs are no longer available." });
      }

      // PHI scan the initial note if supplied. This is a local write
      // (notes never leave the host) but the scan still gates obvious
      // mistakes — staff shouldn't be putting patient names into a
      // field labeled "patient sees this".
      if (typeof customNotes === "string" && customNotes.trim().length > 0) {
        const phi = scanNotesForPhi({
          notes: customNotes,
          jobs: localJobs.map((j) => ({
            patientFirstName: j.patientFirstName,
            patientLastName: j.patientLastName,
            phone: j.phone,
          })),
        });
        if (!phi.ok) {
          return res.status(400).json({ error: phi.reason, code: "PHI_DETECTED" });
        }
      }

      const officeMapping = await getOfficeStatusEnumMapping(user.officeId);
      // Caller may pass an explicit visibility set (per-link override
      // from the dialog); otherwise fall back to the office's per-job-
      // type defaults.
      const requestedVisible = Array.isArray(req.body?.visibleStatuses)
        ? (req.body.visibleStatuses as unknown[])
            .filter((s): s is PatientStatus => typeof s === "string" && (PATIENT_STATUS_VALUES as readonly string[]).includes(s))
        : null;
      const visibility = requestedVisible && requestedVisible.length > 0
        ? requestedVisible
        : await resolveDefaultVisibilityForJobTypes(user.officeId, localJobs.map((j) => j.jobType));

      // Use the most-recently-changed job's current status as the
      // initial event so the patient page renders something on first
      // visit. Gated by visibility — a hidden initial step doesn't
      // surface.
      const sortedByStatusTime = localJobs.slice().sort(
        (a, b) => new Date(b.statusChangedAt).getTime() - new Date(a.statusChangedAt).getTime(),
      );
      const seedJob = sortedByStatusTime[0];
      const initialEnum = seedJob ? mapStatusToEnum(seedJob.status, officeMapping) : null;
      const initialPasses = initialEnum && visibility.includes(initialEnum);

      const result = await portalCreateTrackingLink({
        hostToken,
        jobIds,
        initialStatus: initialPasses ? initialEnum : undefined,
        initialStatusAt: initialPasses && seedJob ? new Date(seedJob.statusChangedAt).toISOString() : undefined,
        expiresAt: typeof expiresAt === "string" ? expiresAt : expiresAt === null ? null : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message, code: result.error.code });
      }

      // Seed per-link visibility before backfilling so the backfill respects it.
      await setLinkVisibility(result.link.token, visibility);
      await backfillEventsForLink(localJobs, hostToken, officeMapping, { id: result.link.id, token: result.link.token });

      // If the caller supplied an initial note, persist it locally.
      if (typeof customNotes === "string" && customNotes.trim().length > 0) {
        await db.insert(trackingLinkNotesLocal).values({
          id: randomUUID(),
          linkToken: result.link.token,
          content: customNotes.trim(),
          createdAt: new Date(),
        });
      }

      trackEvent({ userId: user.id, officeId: user.officeId, eventType: "tracking_link_created", metadata: { jobCount: jobIds.length } });
      res.status(201).json({ link: result.link });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to create tracking link" });
    }
  });

  app.patch("/api/tracking-links/:id", requireAuth, requireNotViewOnly, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(503).json({ error: "Host is not activated" });
    }
    const user = getOfficeUser(req);
    const { id } = req.params;
    // jobIds (coverage) + expiresAt go to the portal. visibleStatuses
    // updates per-link local visibility — the desktop fans out status
    // events through that filter on every subsequent change.
    const { jobIds, expiresAt, visibleStatuses } = req.body || {};
    try {
      if (Array.isArray(jobIds)) {
        if (jobIds.length === 0 || jobIds.length > 10) {
          return res.status(400).json({ error: "jobIds must be 1–10 entries." });
        }
        const { missing } = await loadLocalJobsForOffice(jobIds, user.officeId);
        if (missing.length > 0) {
          return res.status(404).json({ error: "Some of the selected jobs are no longer available." });
        }
      }

      const result = await portalUpdateTrackingLink({
        hostToken,
        id,
        jobIds: Array.isArray(jobIds) ? jobIds : undefined,
        expiresAt: typeof expiresAt === "string" ? expiresAt : expiresAt === null ? null : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message, code: result.error.code });
      }

      // Persist per-link visibility updates locally. Accept an array of
      // canonical enum values; silently filter anything out-of-vocab.
      if (Array.isArray(visibleStatuses)) {
        const cleaned = visibleStatuses
          .filter((s): s is PatientStatus =>
            typeof s === "string" && (PATIENT_STATUS_VALUES as readonly string[]).includes(s),
          );
        await setLinkVisibility(result.link.token, cleaned);
      }

      res.json({ link: result.link });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to update tracking link" });
    }
  });

  // ETA estimate from local archived-job history. Returns the median cycle
  // time (createdAt → archivedAt) for matching jobType + orderDestination
  // combinations among completed archived jobs, then projects forward from
  // the youngest still-active job in the selection.
  app.post("/api/tracking-links/estimate-eta", requireAuth, async (req, res) => {
    const user = getOfficeUser(req);
    const { jobIds } = req.body || {};
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: "jobIds must be a non-empty array" });
    }
    try {
      const { jobs: localJobs } = await loadLocalJobsForOffice(jobIds, user.officeId);
      if (localJobs.length === 0) {
        return res.json({ suggestedDate: null, sampleSize: 0, basis: null });
      }

      // For each (jobType, orderDestination) seen in the selection, pull
      // archived jobs that completed (finalStatus === completed). Use the
      // delta from originalCreatedAt → archivedAt as the cycle time.
      const targetCombos = new Set(
        localJobs.map((j) => `${j.jobType}::${j.orderDestination}`),
      );
      const archived = await db.select().from(archivedJobs).where(
        and(
          eq(archivedJobs.officeId, user.officeId),
          eq(archivedJobs.finalStatus, "completed"),
        ),
      );
      const cycleDays: number[] = [];
      let typeOnlyCycleDays: number[] = [];
      const targetTypes = new Set(localJobs.map((j) => j.jobType));
      for (const a of archived) {
        const created = new Date(a.originalCreatedAt).getTime();
        const archivedAt = new Date(a.archivedAt).getTime();
        if (!Number.isFinite(created) || !Number.isFinite(archivedAt) || archivedAt <= created) continue;
        const days = (archivedAt - created) / (24 * 60 * 60 * 1000);
        const combo = `${a.jobType}::${a.orderDestination}`;
        if (targetCombos.has(combo)) cycleDays.push(days);
        else if (targetTypes.has(a.jobType)) typeOnlyCycleDays.push(days);
      }

      // Prefer same-type-and-lab samples; fall back to same-type-any-lab
      // if the precise combo is too sparse.
      const sample = cycleDays.length >= 3 ? cycleDays : cycleDays.concat(typeOnlyCycleDays);
      if (sample.length === 0) {
        return res.json({ suggestedDate: null, sampleSize: 0, basis: null });
      }
      const sorted = sample.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      // Anchor the projection to the *oldest* selected job's createdAt so
      // the staff sees a date that incorporates how long it's already been
      // in flight.
      const oldestCreated = Math.min(...localJobs.map((j) => new Date(j.createdAt).getTime()));
      const projectedReadyMs = oldestCreated + median * 24 * 60 * 60 * 1000;
      const suggestedDate = new Date(Math.max(projectedReadyMs, Date.now() + 24 * 60 * 60 * 1000)); // never suggest "today"

      const basis = cycleDays.length >= 3
        ? `Median of ${cycleDays.length} similar past orders`
        : `Median of ${sample.length} past ${Array.from(targetTypes).join(" / ")} orders`;

      res.json({
        suggestedDate: suggestedDate.toISOString(),
        sampleSize: sample.length,
        basis,
        medianDays: Math.round(median),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to estimate ETA" });
    }
  });

  app.post("/api/tracking-links/:id/revoke", requireAuth, requireNotViewOnly, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(503).json({ error: "Host is not activated" });
    }
    try {
      const result = await portalRevokeTrackingLink({ hostToken, id: req.params.id });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message, code: result.error.code });
      }
      const user = getOfficeUser(req);
      trackEvent({ userId: user.id, officeId: user.officeId, eventType: "tracking_link_revoked" });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to revoke tracking link" });
    }
  });

  // Append a timestamped note for the patient-facing tracking link.
  // LOCAL-ONLY: notes are stored in the desktop's SQLite and never
  // sent to the portal. The note text still gets a PHI scan as
  // defense-in-depth against staff accidentally including patient
  // identifiers in a field they think the patient sees (they don't —
  // patients see only the canonical status timeline).
  //
  // Caller passes `linkToken` so we key the note on the durable
  // portal token rather than the link's internal UUID.
  app.post("/api/tracking-links/:id/notes", requireAuth, requireNotViewOnly, async (req, res) => {
    const user = getOfficeUser(req);
    const { content, jobIds, linkToken } = req.body || {};
    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Note content is required" });
    }
    const trimmed = content.trim();
    if (trimmed.length > 500) {
      return res.status(400).json({ error: "Note is too long (max 500 chars)" });
    }
    if (typeof linkToken !== "string" || linkToken.length < 16 || linkToken.length > 64) {
      return res.status(400).json({ error: "linkToken is required" });
    }
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: "jobIds must be a non-empty array" });
    }
    try {
      const { jobs: localJobs, missing } = await loadLocalJobsForOffice(jobIds, user.officeId);
      if (missing.length > 0) {
        return res.status(404).json({ error: "Some of the linked jobs are no longer available." });
      }
      const phi = scanNotesForPhi({
        notes: trimmed,
        jobs: localJobs.map((j) => ({
          patientFirstName: j.patientFirstName,
          patientLastName: j.patientLastName,
          phone: j.phone,
        })),
      });
      if (!phi.ok) {
        return res.status(400).json({ error: phi.reason, code: "PHI_DETECTED" });
      }

      const note = {
        id: randomUUID(),
        linkToken,
        content: trimmed,
        createdAt: new Date(),
      };
      await db.insert(trackingLinkNotesLocal).values(note);

      trackEvent({
        userId: user.id,
        officeId: user.officeId,
        eventType: "tracking_link_note_added",
      });
      res.status(201).json({
        note: {
          id: note.id,
          content: note.content,
          createdAt: note.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to add note" });
    }
  });

  // Read / write the office's per-status patient-label synonym choice.
  // Labels are portal-owned (finite synonym list defined in code); the
  // office picks ONE index per status. No free text reaches the portal.
  app.get("/api/tracking-label-choices", requireAuth, async (_req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) return res.json({ choices: {} });
    const result = await portalGetTrackingLabelChoices({ hostToken });
    if (!result.ok) return res.json({ choices: {} });
    res.json({ choices: result.choices });
  });

  app.patch("/api/tracking-label-choices", requireAuth, requireNotViewOnly, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) return res.status(503).json({ error: "Host is not activated" });
    const choices = req.body?.choices;
    if (!choices || typeof choices !== "object") {
      return res.status(400).json({ error: "choices object is required" });
    }
    // Coerce to integer map; the portal does final validation.
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(choices)) {
      if (typeof v === "number" && Number.isInteger(v)) cleaned[k] = v;
    }
    const result = await portalUpdateTrackingLabelChoices({ hostToken, choices: cleaned });
    if (!result.ok) {
      return res.status(result.error.statusCode || 500).json({ error: result.error.message });
    }
    res.json({ choices: result.choices });
  });

  // GET per-link patient-status visibility (local). Returns the array
  // of canonical enum values the office has chosen to surface on this
  // link's patient page. Empty array = nothing visible (rare). Null
  // means the link has never been configured — caller treats as
  // "show everything" until the office picks.
  app.get("/api/tracking-links/visibility/:token", requireAuth, async (req, res) => {
    const token = String(req.params.token || "");
    if (token.length < 16 || token.length > 64) {
      return res.status(400).json({ error: "Invalid token" });
    }
    try {
      const visibility = await getLinkVisibility(token);
      res.json({ visibility: visibility ? Array.from(visibility) : null });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to load visibility" });
    }
  });

  // List local notes for a given tracking link token. Replaces the
  // portal-side notes field — notes never leave this host.
  app.get("/api/tracking-links/notes/:token", requireAuth, async (req, res) => {
    const token = String(req.params.token || "");
    if (token.length < 16 || token.length > 64) {
      return res.status(400).json({ error: "Invalid token" });
    }
    try {
      const rows = await db.select()
        .from(trackingLinkNotesLocal)
        .where(eq(trackingLinkNotesLocal.linkToken, token))
        .orderBy(trackingLinkNotesLocal.createdAt);
      res.json({
        notes: rows.map((r) => ({
          id: r.id,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to load notes" });
    }
  });

  app.post("/api/tracking-links/list", requireAuth, async (req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.status(503).json({ error: "Host is not activated" });
    }
    const { jobIds } = req.body || {};
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: "jobIds must be a non-empty array" });
    }
    try {
      const result = await portalListTrackingLinks({ hostToken, jobIds });
      if (!result.ok) {
        return res.status(result.error.statusCode || 500).json({ error: result.error.message });
      }
      res.json({ links: result.links });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list tracking links" });
    }
  });

  // ── Feature flags for the spotlight system (proxied to portal) ──
  // Portal is opt-out: returns disabled-feature ids only. The desktop
  // surfaces every spotlight in the local registry MINUS this list.
  // Unactivated hosts / portal errors return an empty disabled list so
  // spotlights still render in dev / offline windows.
  app.get("/api/feature-flags", requireAuth, async (_req, res) => {
    const hostToken = getHostToken();
    if (!hostToken) {
      return res.json({ disabledFeatureIds: [] });
    }
    try {
      const result = await portalGetFeatureFlags({ hostToken });
      if (!result.ok) {
        return res.json({ disabledFeatureIds: [] });
      }
      res.json({ disabledFeatureIds: result.disabledFeatureIds });
    } catch {
      res.json({ disabledFeatureIds: [] });
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
  app.post("/api/setup/portal-auth", async (req, res) => {
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({ error: "Setup must be completed on the Host computer." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await portalDesktopAuth({ email, password });
    if (!result.ok) {
      return res.status(result.error.statusCode || 401).json({
        error: result.error.message,
        code: result.error.code,
      });
    }

    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      offices: result.offices,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
    });
  });

  app.post("/api/setup/bootstrap", async (req, res, next) => {
    // Do not trust proxy headers for setup restrictions.
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({
        error: "Setup must be completed on the Host computer.",
      });
    }

    // Part 1.3: Mutex — prevent concurrent bootstrap requests
    if (setupBootstrapInProgress) {
      return res.status(409).json({ error: "Setup already in progress" });
    }
    setupBootstrapInProgress = true;

    try {
      const portalToken = typeof req.body?.portalToken === "string" ? req.body.portalToken.trim() : "";
      const selectedOfficeId = typeof req.body?.officeId === "string" ? req.body.officeId.trim() : "";
      const forceReplace = req.body?.forceReplace === true;
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

      if (!portalToken || !selectedOfficeId) {
        return res.status(400).json({ error: "Portal sign-in is required to set up this Host." });
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

      // Early check: reject if already bootstrapped, BEFORE calling the portal.
      // This prevents consuming a portal activation when the local DB is already set up.
      {
        const [userStats] = db.select({ count: sql`count(*)` }).from(users).all();
        if (Number(userStats?.count) > 0) {
          return res.status(409).json({ error: "This office is already set up.", code: "ALREADY_INITIALIZED" });
        }
      }

      // Portal activation call — if this fails, nothing is written locally.
      let licenseSnapshot = getLicenseSnapshot();
      let activateResult: import("./license-client").LicenseActivateResult | null = null;
      try {
        const activation = await activateHostWithPortalToken(portalToken, selectedOfficeId, { forceReplace });
        licenseSnapshot = activation.snapshot;
        activateResult = activation.activateResult;
      } catch (error: any) {
        const failure = parseSetupActivationFailure(error);
        return res.status(failure.status).json({ error: failure.message, code: failure.code });
      }

      // Pre-compute hashes before the synchronous transaction
      const passwordHash = adminPassword
        ? await hashSecret(adminPassword)
        : await hashSecret(randomBytes(32).toString("hex"));
      const pinHash = await hashSecret(adminPin);

      // Part 1.2: Atomic DB transaction — office + user created together or not at all.
      const { createdOffice, createdUser } = sqlite.transaction(() => {
        const [officeStats] = db.select({ count: sql`count(*)` }).from(offices).all();
        const [userStats] = db.select({ count: sql`count(*)` }).from(users).all();
        const officeCount = Number(officeStats?.count) || 0;
        const userCount = Number(userStats?.count) || 0;

        if (userCount > 0) {
          throw Object.assign(new Error("This office is already set up."), { status: 409 });
        }
        if (officeCount > 1) {
          throw Object.assign(new Error("Multiple offices exist. Please contact support."), { status: 409 });
        }

        const existingUser = db.select().from(users).where(eq(users.loginId, adminLoginId)).limit(1).all()[0];
        if (existingUser) {
          throw Object.assign(new Error("A user with this Login ID already exists."), { status: 409 });
        }

        // Create or update office
        let office;
        if (officeCount === 1) {
          office = db.select().from(offices).limit(1).all()[0];
        } else {
          [office] = db.insert(offices).values({
            id: randomUUID(),
            name: officeName,
            address: officeAddress,
            phone: officePhone,
            email: officeEmail,
          }).returning().all();
        }

        // Use portal-provided office data as fallback if not provided in the request
        const portalOffice = activateResult?.office;
        const finalOfficeName = officeName || portalOffice?.name || "My Practice";
        const finalOfficeAddress = officeAddress ?? portalOffice?.address;
        const finalOfficePhone = officePhone ?? portalOffice?.phone;
        const finalOfficeEmail = officeEmail ?? portalOffice?.email;

        // Start with the full default settings (customStatuses/types/destinations,
        // smsTemplates, onboarding, etc.) so a freshly-bootstrapped host has the
        // same baseline as one created via storage.createOffice. Without this,
        // bootstrapped offices were missing customStatuses/types/destinations
        // entirely, and the wizard auto-launch was broken because the onboarding
        // block was absent (getOnboarding fell back to "completed").
        const seedDefaults = getDefaultOfficeSettings();
        const existingSettings = office.settings && typeof office.settings === "object" && !Array.isArray(office.settings)
          ? (office.settings as Record<string, any>)
          : {};
        const mergedSettings: Record<string, any> = withDefaultMessageTemplates({
          ...seedDefaults,
          ...existingSettings,
        });
        // Always apply the fresh onboarding marker on bootstrap — even if the
        // shell office row was pre-created without one (which the legacy code
        // path in this same transaction does).
        if (!existingSettings.onboarding) {
          mergedSettings.onboarding = defaultOnboardingForNewOffice();
        }
        const activationSucceeded = licenseSnapshot.mode === "ACTIVE";
        mergedSettings.licensing = {
          setupCodeLast4: "portal",
          activationCodeLast4: "portal",
          activationAttemptedAt: Date.now(),
          activationVerifiedAt: activationSucceeded ? licenseSnapshot.activatedAt || Date.now() : null,
        };

        [office] = db.update(offices).set({
          name: finalOfficeName,
          address: finalOfficeAddress,
          phone: finalOfficePhone,
          email: finalOfficeEmail,
          settings: mergedSettings,
          updatedAt: new Date(),
        }).where(eq(offices.id, office.id)).returning().all();

        // Part 1.4: Email generation with max 10 retries
        let adminEmail = buildLocalAuthEmail(adminLoginId, office.id);
        for (let i = 0; i < 10; i++) {
          const existing = db.select().from(users).where(eq(users.email, adminEmail)).limit(1).all()[0];
          if (!existing) break;
          adminEmail = buildLocalAuthEmail(adminLoginId, office.id);
          if (i === 9) throw new Error("Failed to generate unique admin email after 10 attempts");
        }

        const [user] = db.insert(users).values({
          id: randomUUID(),
          email: adminEmail,
          loginId: adminLoginId,
          firstName: adminFirstName,
          lastName: adminLastName,
          password: passwordHash,
          pinHash,
          officeId: office.id,
          role: "owner",
        }).returning().all();

        return { createdOffice: office, createdUser: user };
      })();

      req.login(createdUser, (err) => {
        if (err) return next(err);
        res.status(201).json({
          ok: true,
          office: createdOffice,
          user: withoutPassword(createdUser),
          license: licenseSnapshot,
        });
      });
    } catch (error: any) {
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || "Setup failed" });
    } finally {
      setupBootstrapInProgress = false;
    }
  });

  // ── Client registration (unauthenticated, LAN-access only) ──────────
  app.post("/api/setup/client-register", async (req, res) => {
    try {
      const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
      const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
      const loginId = typeof req.body?.loginId === "string" ? req.body.loginId.trim() : "";
      const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";

      // Validate required fields
      if (!firstName) {
        return res.status(400).json({ error: "First name is required" });
      }
      if (!lastName) {
        return res.status(400).json({ error: "Last name is required" });
      }
      const loginIdError = validateLoginId(loginId);
      if (loginIdError) {
        return res.status(400).json({ error: loginIdError });
      }
      if (!isValidSixDigitPin(pin)) {
        return res.status(400).json({ error: "PIN must be exactly 6 digits" });
      }

      // Check loginId not already taken
      const normalizedLoginId = normalizeLoginId(loginId);
      const existingUser = await storage.getUserByLoginId(normalizedLoginId);
      if (existingUser) {
        return res.status(409).json({ error: "login_id_taken" });
      }

      // Get the local office
      const allOffices = await storage.getAllOffices();
      if (allOffices.length === 0) {
        return res.status(500).json({ error: "No office configured on this Host" });
      }
      const office = allOffices[0];

      // No clientSlots check here: workstation seats are consumed by client
      // DEVICES (client_devices rows, enforced via the over-limit grace +
      // read-only flow), not by user accounts. Several staff share one
      // workstation via PIN login, so gating account creation on user count
      // would wrongly block offices from adding team members.

      // Check for existing pending request
      const pendingRequest = await storage.getPendingAccountSignupRequestByLoginId(office.id, normalizedLoginId);
      if (pendingRequest) {
        return res.status(409).json({ error: "A request for this Login ID is already pending review." });
      }

      // Pre-compute hashes
      const pinHash = await hashSecret(pin);
      const email = buildLocalAuthEmail(normalizedLoginId, office.id);
      const passwordHash = await hashSecret(randomBytes(32).toString("hex"));

      // Create pending account request (requires owner/manager approval)
      const accountRequest = await storage.createAccountSignupRequest({
        officeId: office.id,
        email,
        loginId: normalizedLoginId,
        passwordHash,
        pinHash,
        firstName,
        lastName,
        requestedRole: "staff",
        status: "pending",
        requestMessage: null,
        requestedByIp: req.socket.remoteAddress || null,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
      });

      // Notify owners/managers
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
              message: `${firstName} ${lastName} requested access from a Client workstation (Login ID: ${normalizedLoginId}).`,
              metadata: { accountRequestId: accountRequest.id, loginId: normalizedLoginId },
              linkTo: "/dashboard/team",
            }),
          ),
        );
        // Tell every connected client to refetch — the bell's unread-count
        // query invalidates on office_updated, so approvers see the badge
        // increment without waiting for the 30s poll.
        if (approvers.length > 0) {
          broadcastToOffice(office.id, { type: "office_updated", ts: Date.now(), source: "account_request" });
        }
      } catch (notifyError) {
        console.error("Failed to notify approvers about client registration:", notifyError);
      }

      res.status(202).json({
        ok: true,
        pending: true,
        message: "Your account request has been submitted. An owner or manager will approve it on the Host computer.",
      });
    } catch (error: any) {
      console.error("Client registration failed:", error);
      res.status(500).json({ error: error?.message || "Registration failed" });
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
      const portalToken = typeof req.body?.portalToken === "string" ? req.body.portalToken.trim() : "";
      const selectedOfficeId = typeof req.body?.officeId === "string" ? req.body.officeId.trim() : "";
      const forceReplaceImport = req.body?.forceReplace === true;
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

      if (!portalToken || !selectedOfficeId) {
        return res.status(400).json({ error: "Portal sign-in is required to import data." });
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
        const activation = await activateHostWithPortalToken(portalToken, selectedOfficeId, { forceReplace: forceReplaceImport });
        licenseSnapshot = activation.snapshot;
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

      const result = importSnapshotV1({
        snapshot,
        admin: {
          loginId: adminLoginId,
          firstName: adminFirstName,
          lastName: adminLastName,
          passwordHash: adminPasswordHash,
          pinHash: adminPinHash,
        },
        activationCodeLast4: "portal",
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

      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: "job_created" });

      // Review flow for the order-sheet automation: when the dialog was
      // opened from a needs-review sheet, it sends the ledger row id so
      // the new job gets linked back and the row flips to "imported".
      // Non-fatal — a failed link leaves the row in review, where staff
      // can dismiss it.
      const orderSheetImportId =
        typeof req.body?.orderSheetImportId === "string" ? req.body.orderSheetImportId.trim() : "";
      if (orderSheetImportId) {
        try {
          const sheetRecord = await storage.getOrderSheetImport(orderSheetImportId);
          if (sheetRecord && sheetRecord.officeId === getAuthUser(req).officeId && sheetRecord.status !== "imported") {
            await storage.updateOrderSheetImport(sheetRecord.id, {
              status: "imported",
              jobId: job.id,
              jobOrderId: job.orderId,
              failureReason: null,
            });
            broadcastToOffice(getOfficeUser(req).officeId, {
              type: "office_updated",
              ts: Date.now(),
              source: "order_sheet_automation",
            });

            // The completed review IS the teaching signal: diff what
            // staff submitted against what the parser extracted and
            // learn where the corrected fields live on this form, so
            // the next sheet printed from the same template parses
            // right. Fire-and-forget — learning never blocks creation.
            const learnUserId = getAuthUser(req).id;
            // Pull the office's options so learning can also anchor on
            // the lab/job-type fields by finding their LABELS in the
            // layout — without this, those fields only learn raw-text
            // mappings and can't be fixed when the parser found nothing.
            const learnOffice = await storage.getOffice(sheetRecord.officeId);
            const learnOptions = getOfficeParserOptions((learnOffice?.settings || {}) as Record<string, any>);
            learnFromOrderSheetCorrection({
              storage,
              importRecord: sheetRecord,
              corrected: {
                patientFirstName: job.patientFirstName || "",
                patientLastName: job.patientLastName || "",
                trayNumber: job.trayNumber || "",
                phone: job.phone || "",
                jobTypeId: job.jobType || "",
                destinationId: job.orderDestination || "",
                orderDate: job.createdAt ? new Date(job.createdAt).toISOString().slice(0, 10) : "",
              },
              options: {
                jobTypes: learnOptions.jobTypes,
                destinations: learnOptions.destinations,
              },
              userId: learnUserId,
            })
              .then(({ learnedFields, droppedFields }) => {
                if (learnedFields.length > 0) {
                  console.log(`[order-sheets] learned ${learnedFields.join(", ")} from review of ${sheetRecord.fileName}`);
                }
                if (droppedFields.length > 0) {
                  console.log(`[order-sheets] dropped stale learned rule(s) ${droppedFields.join(", ")} after re-correction of ${sheetRecord.fileName}`);
                }
                // Portal-visible signal that this job came from a sheet
                // review (vs. manual entry / EHR import), plus the size
                // of the learning step it produced.
                trackEvent({
                  userId: learnUserId,
                  officeId: sheetRecord.officeId,
                  eventType: "order_sheet_review_completed",
                  metadata: {
                    learnedFields: learnedFields.length,
                    droppedFields: droppedFields.length,
                  },
                });
              })
              .catch((err) => console.error("[order-sheets] correction learning failed:", err?.message || err));
          }
        } catch (linkError: any) {
          console.error("[order-sheets] failed to link job to ledger row:", linkError?.message || linkError);
        }
      }

      // Auto-generate a tracking link if the office has it on (or the
      // request explicitly opts in). Centralizing this on the server
      // means EHR imports get the same behavior as dialog-created jobs
      // — previously the dialog fired its own POST after the job
      // returned, which the import path bypassed entirely.
      let trackingLinkUrl: string | null = null;
      const requestedAutoGen = req.body?.generateTrackingLink;
      const officeAutoGen = !!(officeSettings as any).trackingLinkDefaults?.autoGenerateTrackingLinks;
      const wantsAutoGen = typeof requestedAutoGen === "boolean" ? requestedAutoGen : officeAutoGen;
      if (wantsAutoGen) {
        const hostToken = getHostToken();
        if (hostToken) {
          const auto = await autoGenerateOrMergeTrackingLinkForJob(job, hostToken);
          trackingLinkUrl = auto.url;
          if (auto.url) {
            trackEvent({
              userId: getAuthUser(req)?.id,
              officeId: job.officeId,
              eventType: "tracking_link_created",
              metadata: { source: "auto_generate", merged: auto.merged ? 1 : 0 },
            });
          }
        }
      }

      res.status(201).json(trackingLinkUrl ? { ...job, trackingLinkUrl } : job);
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
        "createdAt",
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
      // Convert createdAt string to Date for SQLite timestamp_ms column
      if (typeof updates.createdAt === "string") {
        const parsed = new Date(updates.createdAt);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid createdAt date" });
        }
        updates.createdAt = parsed;
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

        // Push the new status as an enum event to any active patient
        // tracking link covering this job. Fire-and-forget — a portal
        // hiccup must not block the local status change. Unmappable
        // statuses are dropped before any portal call is made.
        const localHostToken = getHostToken();
        if (localHostToken) {
          getOfficeStatusEnumMapping(job.officeId)
            .then((mapping) => {
              const mapped = mapStatusToEnum(job.status, mapping);
              if (!mapped) return;
              return emitStatusEventForJob({
                hostToken: localHostToken,
                jobId: job.id,
                status: mapped,
                occurredAt: new Date(job.statusChangedAt).toISOString(),
              });
            })
            .catch((err) => console.error("[tracking-links] event sync failed:", err?.message || err));
        }

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
      
      const hasStatusChange = req.body?.updates?.status && req.body.updates.status !== job.status;
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: hasStatusChange ? "job_status_changed" : "job_updated" });
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
      // Permanent delete (NOT archive): also drop any user uploads. Archive
      // keeps them; this route is the only place active-job uploads die.
      if (job.orderId) {
        await storage.deleteJobAttachmentsByOrderId(job.officeId, job.orderId);
      }
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "job_deleted" });
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ── Bulk operations ──────────────────────────────────────────────────
  app.post("/api/jobs/bulk-update", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { jobIds, updates } = req.body || {};
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: "jobIds array is required" });
      }
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ error: "updates object is required" });
      }
      if (jobIds.length > 500) {
        return res.status(400).json({ error: "Maximum 500 jobs per batch" });
      }

      const officeId = getOfficeUser(req).officeId;
      const userId = getAuthUser(req)?.id;
      let updated = 0;
      let archived = 0;

      const bulkHostToken = getHostToken();
      // Office-wide enum mapping (looked up once per batch — it depends
      // only on settings.trackingLinkDefaults.statusEnumMapping).
      const bulkEnumMapping = bulkHostToken ? await getOfficeStatusEnumMapping(officeId) : undefined;
      for (const jobId of jobIds) {
        if (typeof jobId !== "string") continue;
        const job = await storage.getJob(jobId);
        if (!job || job.officeId !== officeId) continue;

        const oldStatus = job.status;
        await storage.updateJob(jobId, updates, userId);
        updated++;

        // Push status change as an enum event to any active tracking
        // link covering this jobId (fire-and-forget). Unmappable
        // statuses are dropped before any portal call is made.
        if (bulkHostToken && updates.status && updates.status !== oldStatus) {
          const refreshed = await storage.getJob(jobId);
          const mapped = refreshed ? mapStatusToEnum(refreshed.status, bulkEnumMapping) : null;
          if (refreshed && mapped) {
            emitStatusEventForJob({
              hostToken: bulkHostToken,
              jobId: refreshed.id,
              status: mapped,
              occurredAt: new Date(refreshed.statusChangedAt).toISOString(),
            }).catch((err) => console.error("[tracking-links] bulk event failed:", err?.message || err));
          }
        }

        // Auto-archive if status changed to completed/cancelled
        if (updates.status === "completed" || updates.status === "cancelled") {
          const updatedJob = await storage.getJob(jobId);
          if (updatedJob) {
            await storage.archiveJob(updatedJob);
            await storage.deleteJob(jobId);
            archived++;
          }
        }
      }

      await logPhiAccess(req, "update", "patient_list", "bulk-update", undefined, {
        jobCount: updated,
        archived,
        status: updates.status,
      });

      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "bulk_update" });
      trackEvent({ userId: getAuthUser(req)?.id, officeId, eventType: "job_bulk_update", metadata: { count: updated } });
      res.json({ updated, archived });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/jobs/bulk-delete", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { jobIds } = req.body || {};
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: "jobIds array is required" });
      }
      if (jobIds.length > 500) {
        return res.status(400).json({ error: "Maximum 500 jobs per batch" });
      }

      const officeId = getOfficeUser(req).officeId;
      let deleted = 0;

      for (const jobId of jobIds) {
        if (typeof jobId !== "string") continue;
        const job = await storage.getJob(jobId);
        if (!job || job.officeId !== officeId) continue;

        await logPhiAccess(req, "delete", "job", job.id, job.orderId);
        await storage.deleteJob(jobId);
        // Permanent delete: drop user uploads too (archive would keep them).
        if (job.orderId) {
          await storage.deleteJobAttachmentsByOrderId(officeId, job.orderId);
        }
        deleted++;
      }

      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "bulk_delete" });
      res.json({ deleted });
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
      
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: "job_archived" });
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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "job_restored" });
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

  // Linked job IDs — returns all job IDs that are in manual link groups for this office
  app.get("/api/jobs/linked-ids", requireOffice, async (req, res) => {
    try {
      const officeId = getOfficeUser(req).officeId;
      // Get all job IDs that are in link groups, filtered to this office
      const linked = await db
        .select({ jobId: jobLinkGroups.jobId, groupId: jobLinkGroups.groupId })
        .from(jobLinkGroups)
        .innerJoin(jobs, eq(jobLinkGroups.jobId, jobs.id))
        .where(eq(jobs.officeId, officeId));

      // Group by groupId so the client knows which jobs are linked together
      const groups: Record<string, string[]> = {};
      for (const row of linked) {
        if (!groups[row.groupId]) groups[row.groupId] = [];
        groups[row.groupId].push(row.jobId);
      }
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Related jobs — find other jobs for the same patient
  app.get("/api/jobs/:jobId/related", requireOffice, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const firstName = (job.patientFirstName || "").trim().toLowerCase();
      const lastName = (job.patientLastName || "").trim().toLowerCase();
      if (!lastName) return res.json([]);

      // Find active jobs with the same patient name (excluding this job)
      const activeRelated = await db
        .select({
          id: jobs.id,
          orderId: jobs.orderId,
          patientFirstName: jobs.patientFirstName,
          patientLastName: jobs.patientLastName,
          trayNumber: jobs.trayNumber,
          jobType: jobs.jobType,
          status: jobs.status,
          orderDestination: jobs.orderDestination,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.officeId, job.officeId),
            sql`lower(trim(${jobs.patientFirstName})) = ${firstName}`,
            sql`lower(trim(${jobs.patientLastName})) = ${lastName}`,
            sql`${jobs.id} != ${job.id}`,
          ),
        )
        .orderBy(desc(jobs.createdAt));

      // Also check archived jobs
      const archivedRelated = await db
        .select({
          id: archivedJobs.id,
          orderId: archivedJobs.orderId,
          patientFirstName: archivedJobs.patientFirstName,
          patientLastName: archivedJobs.patientLastName,
          trayNumber: archivedJobs.trayNumber,
          jobType: archivedJobs.jobType,
          status: archivedJobs.finalStatus,
          orderDestination: archivedJobs.orderDestination,
          createdAt: archivedJobs.originalCreatedAt,
        })
        .from(archivedJobs)
        .where(
          and(
            eq(archivedJobs.officeId, job.officeId),
            sql`lower(trim(${archivedJobs.patientFirstName})) = ${firstName}`,
            sql`lower(trim(${archivedJobs.patientLastName})) = ${lastName}`,
          ),
        )
        .orderBy(desc(archivedJobs.originalCreatedAt));

      // Also find manually-linked jobs via job_link_groups
      const jobLinkEntry = await db
        .select({ groupId: jobLinkGroups.groupId })
        .from(jobLinkGroups)
        .where(eq(jobLinkGroups.jobId, job.id))
        .limit(1);

      let manuallyLinked: any[] = [];
      if (jobLinkEntry.length > 0) {
        const groupId = jobLinkEntry[0].groupId;
        const linkedEntries = await db
          .select({ jobId: jobLinkGroups.jobId })
          .from(jobLinkGroups)
          .where(and(eq(jobLinkGroups.groupId, groupId), sql`${jobLinkGroups.jobId} != ${job.id}`));

        const linkedJobIds = linkedEntries.map((e) => e.jobId);
        if (linkedJobIds.length > 0) {
          manuallyLinked = await db
            .select({
              id: jobs.id,
              orderId: jobs.orderId,
              patientFirstName: jobs.patientFirstName,
              patientLastName: jobs.patientLastName,
              trayNumber: jobs.trayNumber,
              jobType: jobs.jobType,
              status: jobs.status,
              orderDestination: jobs.orderDestination,
              createdAt: jobs.createdAt,
            })
            .from(jobs)
            .where(sql`${jobs.id} IN (${sql.join(linkedJobIds.map((id) => sql`${id}`), sql`, `)})`)
            .orderBy(desc(jobs.createdAt));
        }
      }

      // Merge and deduplicate
      const seenIds = new Set<string>();
      const related: any[] = [];
      for (const j of [
        ...manuallyLinked.map((j) => ({ ...j, archived: false, manualLink: true })),
        ...activeRelated.map((j) => ({ ...j, archived: false, manualLink: false })),
        ...archivedRelated.map((j) => ({ ...j, archived: true, manualLink: false })),
      ]) {
        if (!seenIds.has(j.id)) {
          seenIds.add(j.id);
          related.push(j);
        }
      }

      const groupId = jobLinkEntry.length > 0 ? jobLinkEntry[0].groupId : null;
      res.json({ jobs: related, groupId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Link jobs — create a link group from selected job IDs
  app.post("/api/jobs/link", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { jobIds } = req.body;
      if (!Array.isArray(jobIds) || jobIds.length < 2) {
        return res.status(400).json({ error: "At least 2 jobs required to create a link" });
      }

      const user = getOfficeUser(req);

      // Check if any of the jobs are already in a link group — merge into that group
      const existingLinks = await db
        .select({ jobId: jobLinkGroups.jobId, groupId: jobLinkGroups.groupId })
        .from(jobLinkGroups)
        .where(sql`${jobLinkGroups.jobId} IN (${sql.join(jobIds.map((id: string) => sql`${id}`), sql`, `)})`);

      let groupId: string;
      if (existingLinks.length > 0) {
        // Use the first existing group — merge all jobs into it
        groupId = existingLinks[0].groupId;
      } else {
        groupId = randomUUID();
      }

      // Insert each job that isn't already in this group
      const existingJobIds = new Set(existingLinks.filter((e) => e.groupId === groupId).map((e) => e.jobId));
      let linked = 0;
      for (const jobId of jobIds) {
        if (existingJobIds.has(jobId)) continue;
        // Remove from any other group first (a job can only be in one group)
        await db.delete(jobLinkGroups).where(eq(jobLinkGroups.jobId, jobId));
        await db.insert(jobLinkGroups).values({
          id: randomUUID(),
          jobId,
          groupId,
          createdBy: user.id,
        });
        linked++;
      }

      broadcastToOffice(user.officeId, { type: "office_updated", ts: Date.now(), source: "job_link" });
      trackEvent({ userId: user.id, officeId: user.officeId, eventType: "job_linked", metadata: { count: linked } });

      // Tracking-link consolidation. Now that staff has *explicitly*
      // declared these jobs belong to the same patient, fold their
      // tracking links into one so the patient gets one shareable URL
      // instead of a per-job pile. Conservative rules:
      //   - 0 active links across the group: do nothing (staff can
      //     generate one from any of the jobs' Tracking tab)
      //   - 1 active link: extend its coverage to include every linked
      //     job (low-surprise — there's only one link to choose from)
      //   - 2+ active links: leave them alone. Folding two existing
      //     patient-facing URLs into one would either silently break
      //     URLs we've already handed out or require us to pick which
      //     to keep, both of which feel worse than "you have two
      //     links, decide". Future: surface this in the Tracking tab.
      // Consolidate tracking links across the linked group. See the
      // commit-4 comment block for the 0/1/2+ active-link rules.
      // Reports back via `trackingLinkConsolidated` so the worklist
      // toast can tell the user their patient now has a single URL
      // covering every linked job (instead of silently doing it).
      let trackingLinkConsolidated = false;
      let trackingLinkConflict = false;
      const hostTokenForMerge = getHostToken();
      if (hostTokenForMerge) {
        try {
          const allGroupIds = await db
            .select({ jobId: jobLinkGroups.jobId })
            .from(jobLinkGroups)
            .where(eq(jobLinkGroups.groupId, groupId));
          const groupJobIds = allGroupIds.map((e) => e.jobId);
          if (groupJobIds.length >= 2 && groupJobIds.length <= 10) {
            const listResult = await portalListTrackingLinks({
              hostToken: hostTokenForMerge,
              jobIds: groupJobIds,
            });
            if (listResult.ok) {
              const activeLinks = listResult.links.filter((l) => l.revokedAt === null);
              if (activeLinks.length >= 2) {
                trackingLinkConflict = true;
              } else if (activeLinks.length === 1) {
                const target = activeLinks[0];
                const mergedIds = Array.from(new Set([...target.jobIds, ...groupJobIds]));
                if (mergedIds.length <= 10 && mergedIds.length > target.jobIds.length) {
                  const { jobs: mergedJobs, missing } = await loadLocalJobsForOffice(
                    mergedIds,
                    user.officeId,
                  );
                  if (missing.length === 0) {
                    await portalUpdateTrackingLink({
                      hostToken: hostTokenForMerge,
                      id: target.id,
                      jobIds: mergedIds,
                    });
                    // Backfill events for the newly-added jobs so the
                    // patient page reflects each one's history on the
                    // (now-expanded) link.
                    const newlyAdded = mergedJobs.filter((j) => !target.jobIds.includes(j.id));
                    const mapping = await getOfficeStatusEnumMapping(user.officeId);
                    await backfillEventsForLink(newlyAdded, hostTokenForMerge, mapping, { id: target.id, token: target.token });
                    trackingLinkConsolidated = true;
                    trackEvent({
                      userId: user.id,
                      officeId: user.officeId,
                      eventType: "tracking_link_merged_on_manual_link",
                      metadata: { groupId, addedJobs: mergedIds.length - target.jobIds.length },
                    });
                  }
                }
              }
            }
          }
        } catch (mergeErr: any) {
          console.error("[tracking-links] post-link merge failed:", mergeErr?.message || mergeErr);
        }
      }

      res.json({ ok: true, groupId, linked, trackingLinkConsolidated, trackingLinkConflict });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Unlink a job from its link group
  app.delete("/api/jobs/:jobId/link", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== getAuthUser(req).officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      await db.delete(jobLinkGroups).where(eq(jobLinkGroups.jobId, job.id));

      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "job_unlink" });
      trackEvent({ userId: getAuthUser(req)?.id, officeId: job.officeId, eventType: "job_unlinked" });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Group notes for linked jobs
  app.get("/api/link-groups/:groupId/notes", requireOffice, async (req, res) => {
    try {
      const notes = await db
        .select({
          id: linkGroupNotes.id,
          content: linkGroupNotes.content,
          createdBy: linkGroupNotes.createdBy,
          createdAt: linkGroupNotes.createdAt,
        })
        .from(linkGroupNotes)
        .where(eq(linkGroupNotes.groupId, req.params.groupId))
        .orderBy(desc(linkGroupNotes.createdAt));

      // Enrich with user names
      const enriched = await Promise.all(
        notes.map(async (note) => {
          if (!note.createdBy) return { ...note, createdByName: "Unknown" };
          const user = await storage.getUser(note.createdBy);
          return {
            ...note,
            createdByName: user ? `${user.firstName} ${user.lastName}`.trim() : "Unknown",
          };
        }),
      );
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/link-groups/:groupId/notes", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "Content is required" });
      }
      const user = getAuthUser(req);
      const id = randomUUID();
      await db.insert(linkGroupNotes).values({
        id,
        groupId: req.params.groupId,
        content: content.trim(),
        createdBy: user.id,
      });
      res.json({ id, groupId: req.params.groupId, content: content.trim(), createdBy: user.id, createdAt: Date.now() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/link-groups/notes/:noteId", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      await db.delete(linkGroupNotes).where(eq(linkGroupNotes.id, req.params.noteId));
      res.json({ ok: true });
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
      
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: "comment_added" });
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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "comment_edited" });

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

  // Drives the "New" badge on order-sheet-automation-created jobs. One
  // entry per job for which THIS user still has an unread
  // job_auto_created notification; clearing the notification (via the
  // bell, "Mark all read", or clicking into the job) removes the entry
  // and the badge.
  app.get("/api/jobs/new-auto-created", requireOffice, async (req, res) => {
    try {
      const jobIds = await storage.getUnreadAutoCreatedJobIds(getOfficeUser(req).id, getOfficeUser(req).officeId);
      res.json(jobIds);
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

      // Store the important note if provided
      const importantNote = typeof req.body?.importantNote === "string" ? req.body.importantNote.trim() : "";
      if (importantNote) {
        await storage.updateJobFlagImportantNote(getAuthUser(req).id, req.params.jobId, importantNote);
      }

      // Notify the rest of the office. Starring is the explicit "this
      // matters, please pay attention" signal — surface it on every
      // teammate's bell, not just on the Starred page.
      await notifyJobStarred(job, getAuthUser(req), storage, importantNote || undefined);

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
      
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: "job_flagged" });
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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getOfficeUser(req)?.officeId, eventType: "job_unflagged" });
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

        // Normalize `trackingLinkDefaults.visibleStatuses` (and any
        // per-jobType override arrays) to follow `customStatuses.order`
        // so the patient page renders the natural progression
        // regardless of the order staff toggled checkboxes here.
        // Without this, clicking "Ready for pickup" before "Order
        // received" landed those IDs in scrambled order in the saved
        // settings and every newly-generated link inherited it.
        const incomingSettings = updates.settings as Record<string, any>;
        const tld = incomingSettings.trackingLinkDefaults;
        if (tld && typeof tld === "object" && !Array.isArray(tld)) {
          // The customStatuses to sort by: prefer the same-update
          // value if the caller's also editing them; otherwise fall
          // back to whatever the office already has stored (server-
          // side merge happens in updateOffice via JSON merge).
          let csForSort: Array<{ id: string; order?: number }> | undefined =
            Array.isArray(incomingSettings.customStatuses)
              ? (incomingSettings.customStatuses as Array<{ id: string; order?: number }>)
              : undefined;
          if (!csForSort) {
            const existing = await storage.getOffice(req.params.id);
            const stored = (existing?.settings as any)?.customStatuses;
            if (Array.isArray(stored)) csForSort = stored as Array<{ id: string; order?: number }>;
          }
          if (csForSort && csForSort.length > 0) {
            if (Array.isArray(tld.visibleStatuses)) {
              tld.visibleStatuses = sortVisibleStatusesByOffice(tld.visibleStatuses, csForSort);
            }
            if (tld.byJobType && typeof tld.byJobType === "object" && !Array.isArray(tld.byJobType)) {
              for (const [k, v] of Object.entries(tld.byJobType as Record<string, any>)) {
                if (v && Array.isArray(v.visibleStatuses)) {
                  (tld.byJobType as Record<string, any>)[k] = {
                    ...v,
                    visibleStatuses: sortVisibleStatusesByOffice(v.visibleStatuses, csForSort),
                  };
                }
              }
            }
          }
        }
      }

      const office = await storage.updateOffice(req.params.id, updates);
      trackEvent({ userId: getAuthUser(req)?.id, officeId: req.params.id, eventType: "settings_changed" });

      // Push a single catalog refresh to every active tracking link in
      // this office whenever any of the *catalog-affecting* fields
      // change, so label edits propagate to the patient page right
      // away. Two sources feed the catalog:
      //   - `customStatuses` — the office's internal status list
      //   - `trackingLinkDefaults.patientStatusLabels` — per-status
      //     patient-facing label overrides
      // Previously only the first triggered a refresh; editing a
      // patient-facing label alone left existing links showing the old
      // label until the next per-link PATCH bumped them.
      const settingsUpdate = (updates.settings as any) ?? {};
      // Patient-facing status labels are now portal-owned (canonical
      // enum) — there's no per-office catalog to push to the portal.
      // The office's customStatuses / patientStatusLabels settings
      // still drive the desktop's INTERNAL UI; they no longer reach
      // the portal in any form.

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
      for (let i = 0; i < 10; i++) {
        if (!(await storage.getUserByEmail(internalEmail))) break;
        internalEmail = buildLocalAuthEmail(loginId, office.id);
        if (i === 9) throw new Error("Failed to generate unique email after 10 attempts");
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

        // No clientSlots check here: approving an account adds a USER, not a
        // workstation. Seats are device-scoped (client_devices + over-limit
        // grace flow); counting users against clientSlots bricked offices
        // whose staff share workstations.

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
        // Look up the request to get the userId before approving (for tablet session invalidation)
        const pendingRequests = await storage.getPinResetRequestsByOffice(getOfficeUser(req).officeId);
        const targetRequest = pendingRequests.find((r) => r.id === req.params.id);

        await storage.approvePinResetRequest(
          req.params.id,
          getOfficeUser(req).officeId,
          getAuthUser(req).id,
        );

        // Invalidate tablet sessions when PIN changes
        if (targetRequest?.userId) {
          await invalidateTabletSessionsForUser(targetRequest.userId);
        }

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

  // ── Owner PIN recovery via portal credentials ──
  // Allows an owner to reset their PIN by authenticating with their portal
  // (ottojobtracker.com) email and password. This covers the case where the
  // sole owner forgets their PIN and no other owner/manager exists to approve.
  app.post("/api/pin-reset/portal", async (req, res) => {
    try {
      const loginId = normalizeLoginId(
        typeof req.body?.loginId === "string" ? req.body.loginId : "",
      );
      const newPin = typeof req.body?.newPin === "string" ? req.body.newPin.trim() : "";
      const portalEmail = typeof req.body?.portalEmail === "string" ? req.body.portalEmail.trim() : "";
      const portalPassword = typeof req.body?.portalPassword === "string" ? req.body.portalPassword : "";

      if (!loginId) return res.status(400).json({ error: "Login ID is required" });
      if (!isValidSixDigitPin(newPin)) {
        return res.status(400).json({ error: "New PIN must be exactly 6 digits" });
      }
      if (!portalEmail || !portalPassword) {
        return res.status(400).json({ error: "Portal email and password are required" });
      }

      // Verify portal credentials
      const authResult = await portalDesktopAuth({ email: portalEmail, password: portalPassword });
      if (!authResult.ok) {
        return res.status(401).json({ error: "Invalid portal credentials." });
      }

      // Check the portal user is an admin/owner for at least one office
      const isAdmin = authResult.offices.some(
        (o) => o.role === "admin" || o.role === "owner",
      );
      if (!isAdmin) {
        return res.status(403).json({
          error: "Only portal administrators can reset PINs this way.",
        });
      }

      // Find the local user
      const user = await storage.getUserByLoginId(loginId);
      if (!user) {
        return res.status(404).json({ error: "No account found with that Login ID." });
      }

      // Reset the PIN
      const newPinHash = await hashSecret(newPin);
      await storage.updateUser(user.id, { pinHash: newPinHash });

      // Invalidate tablet sessions when PIN changes
      await invalidateTabletSessionsForUser(user.id);

      res.json({ ok: true, message: "PIN has been reset successfully. You can now sign in." });
    } catch (error: any) {
      console.error("Portal PIN reset failed:", error);
      res.status(500).json({ error: "PIN reset failed. Please try again." });
    }
  });

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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "notification_rule_created" });
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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "notification_rule_updated" });
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
      trackEvent({ userId: getAuthUser(req)?.id, officeId: getAuthUser(req).officeId, eventType: "notification_rule_deleted" });
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

  // ---------------------------------------------------------------------------
  // CSV Import from EHR
  // ---------------------------------------------------------------------------

  // Templates: list all (built-in + user)
  app.get("/api/import/templates", requireOffice, async (_req, res) => {
    try {
      res.json(getAllTemplates());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Templates: create user template
  app.post("/api/import/templates", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { name, ehrSystem, jobType, fieldMappings, statusMappings, derivedFrom } = req.body || {};
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Template name is required" });
      }
      if (!jobType || typeof jobType !== "string") {
        return res.status(400).json({ error: "Job type is required" });
      }
      const template = createUserTemplate({
        name,
        ehrSystem: ehrSystem || undefined,
        jobType,
        fieldMappings: fieldMappings || {},
        statusMappings: statusMappings || {},
        derivedFrom: derivedFrom || undefined,
      });
      res.status(201).json(template);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Templates: update user template
  app.put("/api/import/templates/:id", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const template = updateUserTemplate(req.params.id, req.body || {});
      res.json(template);
    } catch (error: any) {
      const status = error.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  // Templates: delete user template
  app.delete("/api/import/templates/:id", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      deleteUserTemplate(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      const status = error.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  // CSV parse: return headers, preview rows, and unique status values
  app.post("/api/import/parse", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { filePath, statusColumn } = req.body || {};
      if (!filePath || typeof filePath !== "string") {
        return res.status(400).json({ error: "filePath is required" });
      }
      const result = parseCsvFile(filePath, statusColumn || undefined);

      await logPhiAccess(req, "create", "patient_list", "csv-import-parse", undefined, {
        fileName: filePath.split(/[/\\]/).pop(),
        rowCount: result.totalRows,
      });

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // CSV import: execute import and create jobs
  app.post("/api/import/execute", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const { filePath, jobType, fieldMappings, statusMappings } = req.body || {};
      if (!filePath || typeof filePath !== "string") {
        return res.status(400).json({ error: "filePath is required" });
      }
      if (!jobType || typeof jobType !== "string") {
        return res.status(400).json({ error: "jobType is required" });
      }

      const user = getOfficeUser(req);
      const office = await storage.getOffice(user.officeId);
      const officeSettings = (office?.settings || {}) as Record<string, any>;
      const officeAutoGen = !!officeSettings.trackingLinkDefaults?.autoGenerateTrackingLinks;
      const requestedAutoGen = req.body?.generateTrackingLinks;
      const wantsAutoGen = typeof requestedAutoGen === "boolean" ? requestedAutoGen : officeAutoGen;

      const { notesFromColumns, destinationFallbackColumn } = req.body || {};
      const { importedJobIds, ...publicResult } = executeImport(
        {
          filePath,
          jobType,
          fieldMappings: fieldMappings || {},
          statusMappings: statusMappings || {},
          notesFromColumns: Array.isArray(notesFromColumns) ? notesFromColumns : undefined,
          destinationFallbackColumn: typeof destinationFallbackColumn === "string" ? destinationFallbackColumn : undefined,
          generateTrackingLinks: wantsAutoGen,
        },
        user.officeId,
        user.id,
      );

      await logPhiAccess(req, "create", "patient_list", "csv-import-execute", undefined, {
        imported: publicResult.imported,
        skipped: publicResult.skipped,
      });

      // Notify other clients so they refresh the jobs list
      broadcastToOffice(user.officeId, { type: "office_updated", ts: Date.now(), source: "csv_import" });
      trackEvent({ userId: user.id, officeId: user.officeId, eventType: "csv_import_completed", metadata: { imported: publicResult.imported } });

      // Fire-and-forget auto-gen for each imported active job. Sequential
      // so siblings-from-the-same-import collapse into one shared link
      // via the merge path (two concurrent calls for the same patient
      // would race to create separate links). The import response goes
      // out immediately — staff don't need to wait on portal round-trips
      // for a 200-row CSV.
      if (wantsAutoGen && importedJobIds.length > 0) {
        const hostToken = getHostToken();
        if (hostToken) {
          (async () => {
            for (const jobId of importedJobIds) {
              const job = await storage.getJob(jobId);
              if (!job) continue;
              const auto = await autoGenerateOrMergeTrackingLinkForJob(job, hostToken);
              if (auto.url) {
                trackEvent({
                  userId: user.id,
                  officeId: user.officeId,
                  eventType: "tracking_link_created",
                  metadata: { source: "csv_import", merged: auto.merged ? 1 : 0 },
                });
              }
            }
          })().catch((err) =>
            console.error("[tracking-links] import auto-gen loop failed:", err?.message || err),
          );
        }
      }

      res.json(publicResult);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Order-sheet folder automation
  //
  // The desktop watcher (Host or Client machine) hashes + extracts text from
  // files saved into the watched folder; the renderer ships them here under
  // the signed-in user's session. The server is the single source of truth:
  // it dedups by content hash, parses, auto-creates confident jobs, and
  // records every file in the ledger so all computers see what happened.
  // ---------------------------------------------------------------------------

  const orderSheetIngestSchema = z.object({
    fileName: z.string().min(1).max(300),
    sourcePath: z.string().max(2000).optional(),
    deviceLabel: z.string().max(120).optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i, "contentHash must be a sha256 hex digest"),
    fileSize: z.number().int().nonnegative().optional(),
    text: z.string().max(2_000_000).optional(),
    extractError: z.string().max(500).optional(),
    // Optional viewable copy of the source sheet (raw PDF bytes, base64).
    // Base64 inflates by ~33%, so 35MB encoded covers the ~25MB the
    // desktop watcher already caps reads at. Anything beyond that the
    // server simply ignores — ingest still succeeds without the file.
    attachmentBase64: z.string().max(35_000_000).optional(),
    attachmentExtension: z.string().max(8).optional(),
    attachmentPageCount: z.number().int().min(1).max(500).optional(),
  });

  const getOfficeParserOptions = (officeSettings: Record<string, any>) => {
    const toOptions = (list: unknown): OrderSheetOption[] =>
      Array.isArray(list)
        ? list
            .map((item: any) => ({ id: String(item?.id || ""), label: String(item?.label || "") }))
            .filter((option) => option.id && option.label)
        : [];
    return {
      jobTypes: toOptions(officeSettings.customJobTypes),
      destinations: toOptions(officeSettings.customOrderDestinations),
      identifierMode: (officeSettings.jobIdentifierMode === "trayNumber" ? "trayNumber" : "patientName") as
        | "trayNumber"
        | "patientName",
    };
  };

  // Hash pre-check: lets the watcher skip text extraction for files the
  // office has already processed. Chunked client-side; cap defensively.
  app.post("/api/order-sheets/check", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const raw = Array.isArray(req.body?.hashes) ? req.body.hashes : null;
      if (!raw) return res.status(400).json({ error: "hashes array is required" });
      const hashes = raw
        .filter((h: unknown): h is string => typeof h === "string" && /^[a-f0-9]{64}$/i.test(h))
        .slice(0, 2000);

      const known: string[] = [];
      for (let i = 0; i < hashes.length; i += 400) {
        known.push(...(await storage.getKnownOrderSheetHashes(getOfficeUser(req).officeId, hashes.slice(i, i + 400))));
      }
      res.json({ known });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/order-sheets/ingest", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const payload = orderSheetIngestSchema.parse(req.body || {});
      const user = getOfficeUser(req);
      const contentHash = payload.contentHash.toLowerCase();

      // Dedup before any parsing — the unique index is the real guarantee,
      // this is just the fast path.
      const existing = await storage.getOrderSheetImportByHash(user.officeId, contentHash);
      if (existing) {
        return res.json({ record: existing, created: false, alreadyKnown: true });
      }

      const office = await storage.getOffice(user.officeId);
      const officeSettings = (office?.settings || {}) as Record<string, any>;
      const parserOptions = getOfficeParserOptions(officeSettings);

      // Decode the shipped copy of the sheet up front: the same bytes
      // feed the learned-template extraction during parsing AND the
      // attachment save at the end. Oversized/garbled payloads simply
      // leave this null — ingest works without the file.
      let attachmentBuffer: Buffer | null = null;
      let attachmentExt = "";
      if (payload.attachmentBase64) {
        try {
          const decoded = Buffer.from(payload.attachmentBase64, "base64");
          if (decoded.byteLength > 0 && decoded.byteLength <= 25 * 1024 * 1024) {
            attachmentBuffer = decoded;
            attachmentExt =
              (payload.attachmentExtension || (payload.fileName.split(".").pop() ?? "pdf"))
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .slice(0, 6) || "pdf";
          }
        } catch {
          attachmentBuffer = null;
        }
      }

      const base = {
        officeId: user.officeId,
        fileName: payload.fileName,
        sourcePath: payload.sourcePath || null,
        // "Which computer ingested this" — explicit label wins, otherwise
        // a friendly one ("Mac · Chrome") derived from the request UA.
        deviceLabel: payload.deviceLabel || deriveDeviceAutoLabel(req.headers["user-agent"]) || null,
        contentHash,
        fileSize: payload.fileSize ?? null,
        createdBy: user.id,
      };

      let record;
      let createdJob = null;

      const text = (payload.text || "").trim();
      if (payload.extractError || !text) {
        const claim = await claimOrderSheetRecord(user.officeId, contentHash, {
          ...base,
          status: "failed" as const,
          parsed: null,
          failureReason:
            payload.extractError ||
            "No readable text found — the file may be a scanned image. Open it and create the job manually.",
        });
        if (!claim.claimed) {
          return res.json({ record: claim.record, created: false, alreadyKnown: true });
        }
        record = claim.record;
      } else {
        const parsed = parseOrderSheet(text, parserOptions);

        // Learned templates: if this office has corrected sheets printed
        // from the same form before, extract the taught fields from
        // their anchored positions and let them OVERRIDE the heuristics
        // — staff explicitly taught those locations, which beats
        // vocabulary guessing. Failure anywhere in here degrades to the
        // plain heuristic result.
        let fields = parsed.fields;
        let learnedFields: string[] = [];
        if (attachmentBuffer && attachmentExt === "pdf") {
          try {
            const layout = await extractOrderSheetLayoutFromPdf(attachmentBuffer);
            if (layout) {
              const learned = await applyLearnedOrderSheetTemplates({
                storage,
                officeId: user.officeId,
                layout,
                options: parserOptions,
              });
              if (learned.applied.length > 0) {
                fields = mergeLearnedFields(fields, learned.fields);
                learnedFields = learned.applied;
              }
            }
          } catch (learnError: any) {
            console.error("[order-sheets] learned-template apply failed:", learnError?.message || learnError);
          }
        }

        const missing = computeMissingOrderSheetFields(fields, parserOptions.identifierMode);
        let reviewReason: string | null = null;
        let confident = missing.length === 0;

        // Same guard the manual path has: a tray number that's already in
        // use must never silently create a second job.
        if (confident && parserOptions.identifierMode === "trayNumber" && fields.trayNumber) {
          const dup = await storage.getJobByTrayNumber(user.officeId, fields.trayNumber);
          if (dup) {
            confident = false;
            reviewReason = `Tray number ${fields.trayNumber} is already in use (${dup.orderId}).`;
          }
        }

        // Same-patient sheets within a few days are usually reprints, not
        // second orders — bounce to review instead of double-creating.
        if (confident && parserOptions.identifierMode === "patientName") {
          const recentCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
          const officeJobs = await storage.getJobsByOffice(user.officeId);
          const dup = officeJobs.find(
            (job) =>
              job.patientFirstName.toLowerCase() === fields.patientFirstName.toLowerCase() &&
              job.patientLastName.toLowerCase() === fields.patientLastName.toLowerCase() &&
              new Date(job.createdAt).getTime() >= recentCutoff,
          );
          if (dup) {
            confident = false;
            reviewReason = `Looks like a possible duplicate of ${dup.orderId} (same patient in the last 3 days).`;
          }
        }

        // Claim the hash in the ledger BEFORE creating any job — if two
        // computers ingest the same file at once, exactly one wins the
        // unique index and only the winner proceeds to job creation.
        const claim = await claimOrderSheetRecord(user.officeId, contentHash, {
          ...base,
          status: "needs_review" as const,
          parsed: { fields, missing, ...(learnedFields.length > 0 ? { learnedFields } : {}) },
          failureReason: reviewReason,
        });
        if (!claim.claimed) {
          return res.json({ record: claim.record, created: false, alreadyKnown: true });
        }
        record = claim.record;

        if (confident) {
          try {
            const useTray = parserOptions.identifierMode === "trayNumber";
            const orderDate = fields.orderDate ? new Date(fields.orderDate) : null;
            const jobData = insertJobSchema.parse({
              patientFirstName: useTray ? "" : normalizePatientNamePart(fields.patientFirstName),
              patientLastName: useTray ? "" : normalizePatientNamePart(fields.patientLastName),
              trayNumber: fields.trayNumber || null,
              phone: fields.phone || null,
              jobType: fields.jobTypeId,
              status: "job_created",
              orderDestination: fields.destinationId,
              notes: fields.notes || null,
              source: "order_sheet",
              officeId: user.officeId,
              createdBy: user.id,
            });
            // Backdate `createdAt` to the sheet's order date so the worklist
            // shows when the order was actually placed — but leave
            // `statusChangedAt` to default to NOW (the moment Otto recorded
            // the status). That way "Last Updated" / "Days in status" reflect
            // when this computer added the job, not the EHR's order date.
            // Without that split, a Friday order ingested on Monday would
            // appear as "Last Updated last Friday" the instant it landed.
            const jobValues = orderDate ? ({ ...jobData, createdAt: orderDate } as typeof jobData) : jobData;
            createdJob = await storage.createJob(jobValues);
            record = await storage.updateOrderSheetImport(record.id, {
              status: "imported",
              jobId: createdJob.id,
              jobOrderId: createdJob.orderId,
              failureReason: null,
            });
          } catch (jobError: any) {
            // The claim stays as needs_review so staff can finish by hand.
            record = await storage.updateOrderSheetImport(record.id, {
              failureReason: `Couldn't create the job automatically: ${jobError?.message || "unknown error"}`,
            });
          }
        }
      }

      // Persist the viewable copy of the sheet, if the renderer shipped
      // one (decoded once, up top). Failure here is non-fatal — the
      // ledger row + auto-created job are already done, and a missing
      // attachment just means the details modal shows its "no preview
      // was saved" fallback. Both branches log explicitly so users can
      // confirm via startup.log when an auto-created job's ATTACHMENTS
      // section ends up empty (no payload vs. write failure).
      if (attachmentBuffer) {
        try {
          record = await storage.saveOrderSheetAttachment(
            record.id,
            attachmentBuffer,
            attachmentExt,
            payload.attachmentPageCount,
          );
          console.log(
            `[order-sheets] attached ${attachmentBuffer.byteLength}B (${attachmentExt}) to ${record.fileName} → ${record.jobOrderId || "no job yet"}`,
          );
        } catch (attachErr: any) {
          console.error("[order-sheets] failed to save attachment:", attachErr?.message || attachErr);
        }
      } else {
        console.warn(
          `[order-sheets] no attachment payload for ${record.fileName} — modal will show "no preview was saved"`,
        );
      }

      await logPhiAccess(req, "create", "order_sheet_import", record.id, record.jobOrderId || undefined, {
        fileName: record.fileName,
        status: record.status,
        autoCreated: !!createdJob,
      });
      trackEvent({
        userId: user.id,
        officeId: user.officeId,
        eventType: "order_sheet_ingested",
        metadata: { status: record.status },
      });
      broadcastToOffice(user.officeId, { type: "office_updated", ts: Date.now(), source: "order_sheet_automation" });

      // Office-wide "New" notification per auto-created job so every
      // user sees a badge the next time they open Otto, independent of
      // the worklist's own websocket-driven refresh. Fire-and-forget
      // because notification delivery never blocks ingest.
      if (createdJob) {
        const jobForNotice = createdJob;
        notifyJobAutoCreated(jobForNotice, record.fileName, storage).catch((err) =>
          console.error("[order-sheets] notifyJobAutoCreated failed:", err?.message || err),
        );
      }

      // Auto-created jobs get the same tracking-link treatment as manual
      // and CSV-imported ones — fire-and-forget so ingest stays fast.
      if (createdJob && officeSettings.trackingLinkDefaults?.autoGenerateTrackingLinks) {
        const hostToken = getHostToken();
        if (hostToken) {
          const jobForLink = createdJob;
          (async () => {
            const auto = await autoGenerateOrMergeTrackingLinkForJob(jobForLink, hostToken);
            if (auto.url) {
              trackEvent({
                userId: user.id,
                officeId: user.officeId,
                eventType: "tracking_link_created",
                metadata: { source: "order_sheet", merged: auto.merged ? 1 : 0 },
              });
            }
          })().catch((err) =>
            console.error("[order-sheets] tracking-link auto-gen failed:", err?.message || err),
          );
        }
      }

      res.status(201).json({ record, created: !!createdJob, alreadyKnown: false });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/order-sheets", requireOffice, async (req, res) => {
    try {
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 200;
      const records = await storage.getOrderSheetImportsByOffice(getOfficeUser(req).officeId, limit);

      await logPhiAccess(req, "view", "order_sheet_import", getOfficeUser(req).officeId, undefined, {
        recordCount: records.length,
      });

      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/order-sheets/:id/dismiss", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const record = await storage.getOrderSheetImport(req.params.id);
      if (!record || record.officeId !== getOfficeUser(req).officeId) {
        return res.status(404).json({ error: "Order sheet record not found" });
      }
      if (record.status === "imported") {
        return res.status(400).json({ error: "This sheet already created a job and can't be dismissed" });
      }
      const updated = await storage.updateOrderSheetImport(record.id, { status: "dismissed" });
      broadcastToOffice(getOfficeUser(req).officeId, { type: "office_updated", ts: Date.now(), source: "order_sheet_automation" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Escape hatch: forget everything Otto has learned about this office's
  // order-sheet forms. The correction-driven learner self-heals bad rules
  // when staff re-correct, but this is the blunt reset for a form that's
  // gotten badly stuck. Otto re-learns from subsequent reviews. Owner/
  // manager only — it affects the whole office's parsing.
  app.post(
    "/api/order-sheets/forget-learning",
    requireOffice,
    requireRole(["owner", "manager"]),
    async (req, res) => {
      try {
        const officeId = getOfficeUser(req).officeId;
        const cleared = await storage.deleteAllOrderSheetTemplates(officeId);
        trackEvent({
          userId: getAuthUser(req)?.id,
          officeId,
          eventType: "order_sheet_learning_reset",
          metadata: { cleared },
        });
        res.json({ ok: true, cleared });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Stream the saved viewable copy of the original sheet for an
  // automation-created job. Keyed on the stable orderId (ORD-…) instead
  // of jobs.id so it works for both active jobs and ones already
  // archived — the active job UUID changes when a job moves to
  // archived_jobs, but orderId is the durable handle. (Note: when a job
  // archives, we delete the file from disk to keep storage bounded; this
  // endpoint then 404s and the modal shows its fallback message.)
  app.get("/api/jobs/by-order-id/:orderId/order-sheet-file", requireOffice, async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ error: "orderId is required" });

      const record = await storage.getOrderSheetImportByJobOrderId(
        getOfficeUser(req).officeId,
        orderId,
      );
      if (!record) return res.status(404).json({ error: "No attached order sheet for this job" });

      const absolutePath = storage.resolveOrderSheetAttachmentPath(record);
      if (!absolutePath) return res.status(404).json({ error: "Attachment file is missing" });

      await logPhiAccess(req, "view", "order_sheet_import", record.id, record.jobOrderId || undefined, {
        fileName: record.fileName,
      });

      const ext = (absolutePath.split(".").pop() || "").toLowerCase();
      const mime =
        ext === "pdf" ? "application/pdf"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "txt" || ext === "text" ? "text/plain; charset=utf-8"
        : "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Order-Sheet-Page-Count", String(record.attachmentPageCount ?? 1));
      // The global security middleware stamps X-Frame-Options: DENY and
      // frame-ancestors 'none' on every response — correct for the app
      // shell, but this PARTICULAR response exists to be shown inside the
      // job details modal's same-origin iframe. Relax exactly this
      // response to same-origin framing; cross-origin embedding stays
      // blocked.
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      // Lets the iframe / new tab show the file inline (with the original
      // filename) instead of forcing a download dialog.
      const safeName = record.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      res.sendFile(absolutePath);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Same file, but keyed on the order-sheet-import id — for sheets that
  // haven't become a job yet (needs_review / failed). Lets the Review &
  // create flow open the original PDF alongside the prefilled dialog so
  // staff can verify against the document. Office-scoped lookup so a
  // caller can't reach across offices by id.
  app.get("/api/order-sheets/:id/file", requireOffice, async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "id is required" });

      const record = await storage.getOrderSheetImport(id);
      if (!record || record.officeId !== getOfficeUser(req).officeId) {
        return res.status(404).json({ error: "Order sheet not found" });
      }

      const absolutePath = storage.resolveOrderSheetAttachmentPath(record);
      if (!absolutePath) return res.status(404).json({ error: "Attachment file is missing" });

      await logPhiAccess(req, "view", "order_sheet_import", record.id, record.jobOrderId || undefined, {
        fileName: record.fileName,
      });

      const ext = (absolutePath.split(".").pop() || "").toLowerCase();
      const mime =
        ext === "pdf" ? "application/pdf"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "txt" || ext === "text" ? "text/plain; charset=utf-8"
        : "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      const safeName = record.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      res.sendFile(absolutePath);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Job attachments (ATTACHMENTS section in the job details modal) ───
  // The modal's ATTACHMENTS list unions two sources keyed on the stable
  // ORD-… handle: the ONE auto-imported order sheet (order_sheet_imports,
  // dropped on archive) plus any number of user uploads (job_attachments,
  // kept through archive). All four routes are office-scoped at the
  // storage layer so an id from another office never resolves.

  // Files a browser can show inline; everything else downloads.
  const jobAttachmentMime = (ext: string): { mime: string; inline: boolean } => {
    switch (ext) {
      case "pdf": return { mime: "application/pdf", inline: true };
      case "png": return { mime: "image/png", inline: true };
      case "jpg":
      case "jpeg": return { mime: "image/jpeg", inline: true };
      case "gif": return { mime: "image/gif", inline: true };
      case "webp": return { mime: "image/webp", inline: true };
      case "heic":
      case "heif": return { mime: "image/heic", inline: false };
      case "txt":
      case "text": return { mime: "text/plain; charset=utf-8", inline: true };
      case "csv": return { mime: "text/csv; charset=utf-8", inline: false };
      case "rtf": return { mime: "application/rtf", inline: false };
      case "doc": return { mime: "application/msword", inline: false };
      case "docx": return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false };
      case "xls": return { mime: "application/vnd.ms-excel", inline: false };
      case "xlsx": return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false };
      default: return { mime: "application/octet-stream", inline: false };
    }
  };

  const JOB_ATTACHMENT_EXT_ALLOWLIST = new Set([
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "heif",
    "txt", "text", "csv", "rtf", "doc", "docx", "xls", "xlsx",
  ]);

  const jobAttachmentUploadSchema = z.object({
    fileName: z.string().min(1).max(300),
    // Base64 inflates ~33%; 35MB encoded covers the 25MB decoded cap below.
    fileBase64: z.string().min(1).max(35_000_000),
    ext: z.string().max(8).optional(),
    mimeType: z.string().max(160).optional(),
  });

  // List every attachment for an order (order sheet + uploads), each with
  // a ready-to-use fileUrl. Keyed on orderId so active and archived jobs
  // both resolve. No PHI body — just metadata; the file routes log access.
  app.get("/api/jobs/by-order-id/:orderId/attachments", requireOffice, async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ error: "orderId is required" });
      const officeId = getOfficeUser(req).officeId;
      const encodedOrderId = encodeURIComponent(orderId);

      const items: any[] = [];

      // The auto-imported order sheet, if its file is still on disk (it's
      // unlinked on archive, so this naturally drops off once archived).
      const sheet = await storage.getOrderSheetImportByJobOrderId(officeId, orderId);
      if (sheet?.attachmentPath) {
        const sheetExt = (sheet.attachmentPath.split(".").pop() || "pdf").toLowerCase();
        items.push({
          id: sheet.id,
          kind: "order_sheet",
          fileName: sheet.fileName,
          ext: sheetExt,
          mimeType: jobAttachmentMime(sheetExt).mime,
          size: sheet.attachmentSize ?? null,
          pageCount: sheet.attachmentPageCount ?? null,
          inline: jobAttachmentMime(sheetExt).inline,
          deletable: false,
          createdAt: sheet.createdAt,
          fileUrl: `/api/jobs/by-order-id/${encodedOrderId}/order-sheet-file`,
        });
      }

      // User uploads (kept through archive).
      const uploads = await storage.getJobAttachmentsByOrderId(officeId, orderId);
      for (const upload of uploads) {
        const info = jobAttachmentMime(upload.ext);
        items.push({
          id: upload.id,
          kind: "upload",
          fileName: upload.fileName,
          ext: upload.ext,
          mimeType: upload.mimeType || info.mime,
          size: upload.size ?? null,
          pageCount: null,
          inline: info.inline,
          deletable: true,
          createdBy: upload.createdBy,
          createdAt: upload.createdAt,
          fileUrl: `/api/jobs/by-order-id/${encodedOrderId}/attachments/${upload.id}/file`,
        });
      }

      res.json({ attachments: items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upload a document onto a job. Base64-JSON (no multipart anywhere in
  // the app). Gated to a real order in this office so we can't seed orphan
  // rows. 25MB decoded cap; extension must be on the allowlist.
  app.post(
    "/api/jobs/by-order-id/:orderId/attachments",
    requireOffice,
    requireNotViewOnly,
    async (req, res) => {
      try {
        const orderId = String(req.params.orderId || "").trim();
        if (!orderId) return res.status(400).json({ error: "orderId is required" });
        const officeId = getOfficeUser(req).officeId;

        if (!(await storage.orderIdExistsInOffice(officeId, orderId))) {
          return res.status(404).json({ error: "Order not found" });
        }

        const payload = jobAttachmentUploadSchema.parse(req.body || {});

        let fileBuffer: Buffer;
        try {
          fileBuffer = Buffer.from(payload.fileBase64, "base64");
        } catch {
          return res.status(400).json({ error: "Invalid file data" });
        }
        if (fileBuffer.byteLength === 0) {
          return res.status(400).json({ error: "File is empty" });
        }
        if (fileBuffer.byteLength > 25 * 1024 * 1024) {
          return res.status(413).json({ error: "File exceeds the 25MB limit" });
        }

        const ext =
          (payload.ext || (payload.fileName.split(".").pop() ?? ""))
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 6);
        if (!JOB_ATTACHMENT_EXT_ALLOWLIST.has(ext)) {
          return res.status(415).json({ error: "Unsupported file type" });
        }

        const saved = await storage.saveJobAttachment({
          officeId,
          jobOrderId: orderId,
          fileBuffer,
          fileName: payload.fileName,
          ext,
          mimeType: payload.mimeType || jobAttachmentMime(ext).mime,
          createdBy: getAuthUser(req)?.id ?? null,
        });
        // Logged for cross-computer visibility — Client computers POST here
        // (same as order sheets); the file is saved on the Host's disk so
        // every other computer sees it via the file-serve endpoint. The
        // log line is the user-visible breadcrumb that the upload landed.
        console.log(
          `[job-attachments] uploaded ${fileBuffer.byteLength}B (${ext}) "${saved.fileName}" → ${orderId} (host data dir)`,
        );

        await logPhiAccess(req, "create", "job_attachment", saved.id, orderId, {
          fileName: saved.fileName,
        });
        trackEvent({
          userId: getAuthUser(req)?.id,
          officeId,
          eventType: "attachment_uploaded",
          metadata: { ext: saved.ext, size: saved.size ?? 0 },
        });

        res.status(201).json({
          attachment: {
            id: saved.id,
            kind: "upload",
            fileName: saved.fileName,
            ext: saved.ext,
            mimeType: saved.mimeType,
            size: saved.size,
            deletable: true,
            createdBy: saved.createdBy,
            createdAt: saved.createdAt,
            fileUrl: `/api/jobs/by-order-id/${encodeURIComponent(orderId)}/attachments/${saved.id}/file`,
          },
        });
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ error: "Invalid upload payload" });
        }
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Stream one uploaded attachment. Same same-origin framing relaxation as
  // the order-sheet-file route so it can show in the modal's iframe.
  app.get("/api/jobs/by-order-id/:orderId/attachments/:attachmentId/file", requireOffice, async (req, res) => {
    try {
      const officeId = getOfficeUser(req).officeId;
      const attachmentId = String(req.params.attachmentId || "").trim();
      if (!attachmentId) return res.status(400).json({ error: "attachmentId is required" });

      const record = await storage.getJobAttachment(officeId, attachmentId);
      if (!record) return res.status(404).json({ error: "Attachment not found" });

      const absolutePath = storage.resolveJobAttachmentPath(record);
      if (!absolutePath) return res.status(404).json({ error: "Attachment file is missing" });

      await logPhiAccess(req, "view", "job_attachment", record.id, record.jobOrderId || undefined, {
        fileName: record.fileName,
      });

      // Always derive Content-Type from the validated extension. The client
      // submits mimeType too, but trusting it would let a user upload PNG
      // bytes with mimeType "text/html" and have them served as HTML inside
      // the modal's same-origin iframe — a same-origin XSS vector.
      const info = jobAttachmentMime(record.ext);
      res.setHeader("Content-Type", info.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      const safeName = record.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Disposition", `${info.inline ? "inline" : "attachment"}; filename="${safeName}"`);
      res.sendFile(absolutePath);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete one uploaded attachment (file + row). Order sheets aren't
  // deletable here — they're managed by the job lifecycle.
  app.delete("/api/jobs/by-order-id/:orderId/attachments/:attachmentId", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      const officeId = getOfficeUser(req).officeId;
      const attachmentId = String(req.params.attachmentId || "").trim();
      if (!attachmentId) return res.status(400).json({ error: "attachmentId is required" });

      const record = await storage.getJobAttachment(officeId, attachmentId);
      if (!record) return res.status(404).json({ error: "Attachment not found" });

      await logPhiAccess(req, "delete", "job_attachment", record.id, record.jobOrderId || undefined, {
        fileName: record.fileName,
      });
      await storage.deleteJobAttachment(officeId, attachmentId);
      trackEvent({
        userId: getAuthUser(req)?.id,
        officeId,
        eventType: "attachment_deleted",
        metadata: { ext: record.ext },
      });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Order-sheet watcher presence ────────────────────────────────────
  // Each watching computer's renderer posts a heartbeat (~60s + on status
  // change). The panel on the Order Sheets page reads the office-wide list
  // so any desk can see which machines are actually watching. Telemetry
  // only — no PHI, no broadcast (the panel polls on its own interval).

  const watcherHeartbeatSchema = z.object({
    deviceId: z.string().min(8).max(64),
    folderPath: z.string().max(2000).optional(),
    enabled: z.boolean(),
    state: z.enum(["watching", "error", "stopped"]),
    error: z.string().max(500).optional(),
  });

  app.post("/api/order-sheets/watcher-heartbeat", requireOffice, async (req, res) => {
    try {
      const payload = watcherHeartbeatSchema.parse(req.body || {});
      const watcher = await storage.upsertOrderSheetWatcher({
        deviceId: payload.deviceId,
        officeId: getOfficeUser(req).officeId,
        deviceLabel: deriveDeviceAutoLabel(req.headers["user-agent"]) || null,
        folderPath: payload.folderPath || null,
        enabled: payload.enabled,
        state: payload.state,
        error: payload.error || null,
      });
      res.json(watcher);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/order-sheets/watchers", requireOffice, async (req, res) => {
    try {
      const watchers = await storage.getOrderSheetWatchersByOffice(getOfficeUser(req).officeId);
      res.json(watchers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a stale entry (replaced/retired computer). If the machine is
  // actually still alive, its next heartbeat simply re-creates the row.
  app.delete("/api/order-sheets/watchers/:deviceId", requireOffice, requireNotViewOnly, async (req, res) => {
    try {
      await storage.deleteOrderSheetWatcher(getOfficeUser(req).officeId, req.params.deviceId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Backups: run-now ───────────────────────────────────────────────
  // Recovery insurance for any office user; requireOffice + requireNotViewOnly
  // is intentional — no role gate beyond that.
  app.post("/api/backups/run-now", requireOffice, requireNotViewOnly, async (_req, res) => {
    const runner = (globalThis as any).__ottoRunBackupNow;
    if (typeof runner !== "function") {
      return res.status(503).json({ ok: false, error: "Backups are only available when running on the Host." });
    }
    try {
      const result = await runner();
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || String(error) });
    }
  });

  // ── Tablet Job Board (slot-gated, LAN-accessible) ──────────────────
  // Full tablet API + SPA serving is handled by tablet-routes.ts.
  registerTabletRoutes(app);

  // ── Client device management ───────────────────────────────────────

  /**
   * Devices list with live presence + logged-in user. Used by the
   * Host's Settings → Computers tab. Owner/manager only.
   *
   * Live status comes from sync-websocket's officeConnections map
   * (which tracks open WS sockets per office) — no extra timer or
   * heartbeat needed. Disconnects ripple via the office_updated
   * broadcast in sync-websocket.ts so the tab auto-refreshes.
   */
  app.get("/api/devices", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user || !["owner", "manager"].includes(user.role || "")) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const officeId = (user as any).officeId;
      const devices = db.select().from(clientDevicesTable).all();
      const presence = officeId ? getOfficeClientPresence(officeId) : new Map<string, { userId: string | null }>();

      // Resolve logged-in user names for every device that's
      // currently connected. Batch-fetch unique userIds rather than
      // N lookups in the loop below.
      const userIds = Array.from(new Set(
        Array.from(presence.values())
          .map((p) => p.userId)
          .filter((u): u is string => typeof u === "string" && u.length > 0),
      ));
      const userById = new Map<string, { id: string; firstName: string; lastName: string }>();
      for (const uid of userIds) {
        const u = await storage.getUser(uid);
        if (u) userById.set(u.id, { id: u.id, firstName: u.firstName, lastName: u.lastName });
      }

      const enriched = devices.map((d) => {
        const p = presence.get(d.id);
        const connected = !!p;
        const loggedInUser = p?.userId ? userById.get(p.userId) ?? null : null;
        // Display name precedence: user-set `name` > parsed
        // `auto_label` > "Unknown computer".
        const displayName = (d.name && d.name.trim().length > 0)
          ? d.name.trim()
          : (d.autoLabel && d.autoLabel.trim().length > 0 ? d.autoLabel.trim() : "Unknown computer");
        return {
          id: d.id,
          displayName,
          name: d.name ?? null,
          autoLabel: d.autoLabel ?? null,
          connected,
          loggedInUser: loggedInUser
            ? { id: loggedInUser.id, firstName: loggedInUser.firstName, lastName: loggedInUser.lastName }
            : null,
          firstSeenAt: d.firstSeenAt instanceof Date ? d.firstSeenAt.toISOString() : new Date(d.firstSeenAt as any).toISOString(),
          lastSeenAt: d.lastSeenAt instanceof Date ? d.lastSeenAt.toISOString() : new Date(d.lastSeenAt as any).toISOString(),
          blocked: !!d.blocked,
        };
      });

      // Sort: currently-connected first, then by lastSeenAt desc so
      // recently-active machines stay near the top of the list.
      enriched.sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
      });

      res.json({ devices: enriched, connectedCount: presence.size });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/devices/:id/unblock", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user || !["owner", "manager"].includes(user.role || "")) {
        return res.status(403).json({ error: "Not authorized" });
      }
      db.update(clientDevicesTable).set({ blocked: false }).where(eq(clientDevicesTable.id, req.params.id)).run();
      const officeId = (user as any).officeId;
      if (officeId) broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "device_unblocked" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Rename a Client computer. Owner/manager only. The user-set `name`
   * takes precedence over the auto-derived `autoLabel` for display.
   * Setting an empty string clears the override back to auto.
   */
  app.patch("/api/devices/:id", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user || !["owner", "manager"].includes(user.role || "")) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const raw = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      // Cap at 60 chars — longer names break the table layout and
      // there's no real reason to need more for "Lab Mac mini" etc.
      const name = raw.length === 0 ? null : raw.slice(0, 60);
      const existing = db.select().from(clientDevicesTable).where(eq(clientDevicesTable.id, req.params.id)).get();
      if (!existing) return res.status(404).json({ error: "Device not found" });
      db.update(clientDevicesTable).set({ name }).where(eq(clientDevicesTable.id, req.params.id)).run();
      const officeId = (user as any).officeId;
      if (officeId) broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "device_renamed" });
      res.json({ ok: true, name });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Force-remove a Client computer. Owner/manager only. Same effect
   * as the Client self-release: deletes the local row (frees the
   * seat) and revokes the portal-side recovery token so the kicked
   * Client can't auto-recover via portal lookup. The kicked Client's
   * next WS reconnect will fail; it'll see the "removed from office"
   * banner on its next portal lookup attempt.
   */
  app.delete("/api/devices/:id", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user || !["owner", "manager"].includes(user.role || "")) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const existing = db.select().from(clientDevicesTable).where(eq(clientDevicesTable.id, req.params.id)).get();
      if (!existing) return res.status(404).json({ error: "Device not found" });

      if (existing.recoveryId) {
        const hostToken = getHostToken();
        if (hostToken) {
          portalRevokeClientRecovery({ hostToken, recoveryId: existing.recoveryId })
            .catch((err) => console.error("[devices] recovery revoke failed:", err?.message || err));
        }
      }

      db.delete(clientDevicesTable).where(eq(clientDevicesTable.id, req.params.id)).run();

      try {
        await logPhiAccess(req, "delete", "patient_list", `device:${req.params.id}`, undefined, {
          event: "client_device_removed_by_admin",
          deviceName: existing.name ?? existing.autoLabel ?? null,
        });
      } catch { /* non-critical */ }

      trackEvent({
        userId: user.id,
        officeId: (user as any).officeId,
        eventType: "client_device_removed_by_admin",
        metadata: { deviceName: existing.name ?? existing.autoLabel ?? null },
      });

      const officeId = (user as any).officeId;
      if (officeId) broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "device_removed" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Client uninstall: the Client computer is announcing that it's
   * about to remove itself. We:
   *   1. Delete its client_devices row so the seat is FREED on the
   *      Host immediately (the live count derived by
   *      getRegisteredDeviceCount drops by one).
   *   2. Audit-log the release with the user identity that initiated
   *      it, so it shows up in the office's activity feed.
   *
   * The Client follows up locally by wiping its userData (config,
   * deviceId, certs) via the Electron IPC handler and showing the
   * "drag Otto to Trash" final screen.
   *
   * Auth: any authenticated session can release the device it's
   * connected from. Staff don't need admin to take their own
   * computer off the account.
   */
  app.post("/api/devices/self/release", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Refuse releases from localhost. The Host's own browser
      // session connects via 127.0.0.1; Client browsers connect over
      // the LAN. A localhost POST here means someone is trying to
      // release a seat from the Host's own UI, which (a) is never
      // a legitimate flow (Host doesn't sit on a clientSlots seat),
      // and (b) would be the second half of a Host-wipe attempt.
      // Defense in depth — the Electron IPC primarily blocks this,
      // but the server should refuse independently.
      const ip = (req.ip || "").toString();
      const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
      if (isLocal) {
        return res.status(403).json({
          error: "This action is only available from a Client computer. To replace the Host, use the portal's Replace Host flow.",
          code: "HOST_CANNOT_SELF_RELEASE",
        });
      }

      const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
      if (!deviceId || deviceId.length > 128) {
        return res.status(400).json({ error: "deviceId required" });
      }

      const existing = db.select().from(clientDevicesTable).where(eq(clientDevicesTable.id, deviceId)).get();
      if (!existing) {
        // Already gone — return success so the Client can finish
        // the local wipe without surfacing a confusing error.
        return res.json({ ok: true, alreadyReleased: true });
      }

      // Revoke the portal-side recovery token first so this Client
      // can't auto-discover a new Host after wiping. Fire-and-forget:
      // if the portal is unreachable, we still delete the local row
      // — leaving the recovery row alive is the lesser evil (the
      // office admin can revoke from the device list later).
      if (existing.recoveryId) {
        const hostToken = getHostToken();
        if (hostToken) {
          portalRevokeClientRecovery({ hostToken, recoveryId: existing.recoveryId })
            .catch((err) => console.error("[devices] recovery revoke failed:", err?.message || err));
        }
      }

      db.delete(clientDevicesTable).where(eq(clientDevicesTable.id, deviceId)).run();

      try {
        await logPhiAccess(req, "delete", "patient_list", `device:${deviceId}`, undefined, {
          event: "client_seat_released",
          deviceLabel: existing.name ?? existing.autoLabel ?? null,
        });
      } catch { /* non-critical */ }

      trackEvent({
        userId: user.id,
        officeId: (user as any).officeId,
        eventType: "client_seat_released",
        metadata: { deviceLabel: existing.name ?? existing.autoLabel ?? null },
      });

      // Notify connected clients so an admin watching the device
      // list sees the row disappear in real time.
      const officeId = (user as any).officeId;
      if (officeId) {
        broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "client_seat_released" });
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Legacy /tablet/heartbeat and /tablet/board routes removed — now handled by registerTabletRoutes() above.

  const server = createAppServer(app);
  return { server, sessionMiddleware };
}
