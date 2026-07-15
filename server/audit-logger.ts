import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

type AuditOutcome = "success" | "denied" | "error";

export interface AuditLogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  outcome: AuditOutcome;
  userId?: string;
  officeId?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
  entityType?: string;
  entityId?: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function getAuditLogFilePath(): string {
  if (process.env.OTTO_AUDIT_LOG_PATH) return process.env.OTTO_AUDIT_LOG_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  return path.join(dataDir, "audit_log.jsonl");
}

function getMaxBytes(): number {
  // Floor is just large enough to hold one log line, not a production
  // recommendation — it only exists to reject 0/negative values that would
  // roll the log over on every single write.
  return parseIntegerEnv("OTTO_AUDIT_LOG_MAX_BYTES", DEFAULT_MAX_BYTES, 100);
}

function parseIntegerEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    console.warn(`[audit] Invalid ${name} value "${raw}". Using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function truncate(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function sanitizeTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function sanitizeOutcome(value: unknown): AuditOutcome {
  if (value === "denied" || value === "error") return value;
  return "success";
}

function sanitizeEntry(entry: AuditLogEntry): AuditLogEntry {
  const method = truncate(entry.method, 12)?.toUpperCase() || "GET";
  const pathValue = (truncate(entry.path, 220) || "/").split("?")[0] || "/";

  return {
    timestamp: sanitizeTimestamp(entry.timestamp),
    method,
    path: pathValue,
    statusCode: toNonNegativeInteger(entry.statusCode),
    durationMs: toNonNegativeInteger(entry.durationMs),
    outcome: sanitizeOutcome(entry.outcome),
    userId: truncate(entry.userId, 80),
    officeId: truncate(entry.officeId, 80),
    role: truncate(entry.role, 32),
    ipAddress: truncate(entry.ipAddress, 80),
    userAgent: truncate(entry.userAgent, 220),
    entityType: truncate(entry.entityType, 60),
    entityId: truncate(entry.entityId, 120),
  };
}

// ── Request → AuditLogEntry (B8) ──
// Moved here (from server/index.ts) so both the app-facing (/api/*) and
// tablet-facing (/tablet/api/*) request-audit middleware share one code
// path for turning a request/response pair into an audit record.

function normalizeIpForAudit(ip: string): string {
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

/**
 * Collapses id-shaped path segments (UUIDs, numeric ids, long hex/opaque
 * ids) down to ":id" so audit records group by route rather than by every
 * distinct entity. Entity identity itself is captured separately by
 * extractAuditEntity() from the RAW (pre-normalization) path.
 */
export function normalizeAuditPath(requestPath: string): string {
  return (requestPath || "/")
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[a-f0-9]{24,}(?=\/|$)/gi, "/:id")
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:id");
}

export function getRequestIp(req: Request): string {
  const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
  const forwardedFor = trustProxy
    ? (req.headers?.["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    : undefined;

  const remote = forwardedFor || req.socket?.remoteAddress || req.ip || "unknown";
  return normalizeIpForAudit(remote);
}

// Same id-shape regexes normalizeAuditPath() uses to collapse path
// segments to ":id" — reused here (whole-segment match) so a segment only
// counts as an id if the normalizer would also treat it as one.
const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_SEGMENT_RE = /^\d+$/;
const HEX24_SEGMENT_RE = /^[a-f0-9]{24,}$/i;
const OPAQUE20_SEGMENT_RE = /^[A-Za-z0-9_-]{20,}$/;

function isIdShapedSegment(segment: string): boolean {
  return (
    UUID_SEGMENT_RE.test(segment) ||
    DIGITS_SEGMENT_RE.test(segment) ||
    HEX24_SEGMENT_RE.test(segment) ||
    OPAQUE20_SEGMENT_RE.test(segment)
  );
}

/**
 * Pulls a coarse {entityType, entityId} out of the RAW (pre-normalization)
 * request path. entityId is the first id-shaped segment (same shapes as
 * normalizeAuditPath's ":id" collapse), so it is always a real identifier,
 * never a literal resource word. entityType is the raw segment right
 * before it (the resource collection), taken as-is with no singularization.
 * Examples:
 *   /api/jobs                          -> {entityType: "jobs"}
 *   /api/jobs/<uuid>                   -> {entityType: "jobs", entityId: "<uuid>"}
 *   /api/jobs/<uuid>/comments          -> {entityType: "jobs", entityId: "<uuid>"}
 *   /tablet/api/jobs/<id>/status       -> {entityType: "jobs", entityId: "<id>"}
 *   /api/admin/offices/<id>/status     -> {entityType: "offices", entityId: "<id>"}
 * If no segment is id-shaped, entityType falls back to the last non-empty
 * segment (the resource itself) and entityId is undefined.
 */
function extractAuditEntity(rawPath: string): { entityType?: string; entityId?: string } {
  const clean = (rawPath || "/").split("?")[0];
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return {};

  const idIndex = segments.findIndex(isIdShapedSegment);
  if (idIndex === -1) {
    return { entityType: segments[segments.length - 1] };
  }

  return {
    entityType: idIndex > 0 ? segments[idIndex - 1] : undefined,
    entityId: segments[idIndex],
  };
}

// PHI-bearing route prefixes. Successful reads (GET/HEAD < 400) against
// these are audited even though they aren't mutations, per HIPAA
// 164.312(b). Pure health/config/heartbeat/poll endpoints are excluded —
// they carry no PHI (e.g. /tablet/api/poll returns only {lastModified})
// and firing on every ~5s poll would just be noise.
const PHI_AUDIT_PATH_PREFIXES = [
  "/api/jobs",
  "/api/patients",
  "/api/order-sheets",
  "/api/link-groups",
  "/api/search",
  "/tablet/api/jobs",
  "/tablet/api/track",
];

export function isPhiAuditPath(requestPath: string): boolean {
  const clean = (requestPath || "/").split("?")[0];
  return PHI_AUDIT_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
  );
}

/**
 * Builds an AuditLogEntry from a request/response pair. Resolves the actor
 * from either the portal/app session (req.user) or a tablet session
 * (req.tabletUser) — tablet requests never populate req.user, and tablet
 * users have no `role`.
 */
export function buildAuditEntry(req: Request, res: Response, durationMs: number): AuditLogEntry {
  const method = String(req.method || "GET").toUpperCase();
  const rawPath = req.path || "/";
  const statusCode = res.statusCode;

  const sessionUserId = typeof req.user?.id === "string" ? req.user.id : undefined;
  const sessionOfficeId = typeof req.user?.officeId === "string" ? req.user.officeId : undefined;
  const role = typeof req.user?.role === "string" ? req.user.role : undefined;

  const userId = sessionUserId ?? req.tabletUser?.userId;
  const officeId = sessionOfficeId ?? req.tabletUser?.officeId;

  const { entityType, entityId } = extractAuditEntity(rawPath);

  return {
    timestamp: new Date().toISOString(),
    method,
    path: normalizeAuditPath(rawPath),
    statusCode,
    durationMs,
    outcome: statusCode >= 500 ? "error" : statusCode >= 400 ? "denied" : "success",
    userId,
    officeId,
    role,
    ipAddress: getRequestIp(req),
    userAgent:
      statusCode >= 400 && typeof req.headers?.["user-agent"] === "string"
        ? (req.headers["user-agent"] as string)
        : undefined,
    entityType,
    entityId,
  };
}

let writeQueue: Promise<void> = Promise.resolve();

// Monotonic tie-breaker so two rollovers within the same millisecond never
// collide on the archive filename.
let rolloverSequence = 0;

function archiveFilePath(logFile: string): string {
  // ISO-basic timestamp (no colons/dots) so the name is safe on every
  // filesystem: 20260714T153045123Z
  const isoBasic = new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z");
  rolloverSequence += 1;
  return path.join(path.dirname(logFile), `audit_log.${isoBasic}-${rolloverSequence}.jsonl`);
}

// HIPAA requires 6 years of audit retention. Audit entries are never
// dropped: once the active log exceeds the size cap it is renamed into a
// timestamped archive file that is kept forever, and writes continue into a
// fresh audit_log.jsonl.
async function rolloverAuditLog(logFile: string): Promise<void> {
  try {
    await fs.promises.rename(logFile, archiveFilePath(logFile));
  } catch (error: any) {
    if (error?.code === "ENOENT") return; // nothing to roll over
    throw error;
  }
}

async function appendAuditLogEntry(entry: AuditLogEntry): Promise<void> {
  const logFile = getAuditLogFilePath();
  await fs.promises.mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
  await fs.promises.appendFile(logFile, `${JSON.stringify(entry)}\n`, { encoding: "utf-8", mode: 0o600 });

  const stats = await fs.promises.stat(logFile).catch(() => null);
  if (stats && stats.size > getMaxBytes()) {
    await rolloverAuditLog(logFile);
  }
}

export function logAudit(entry: AuditLogEntry): void {
  const sanitized = sanitizeEntry(entry);
  writeQueue = writeQueue
    .then(() => appendAuditLogEntry(sanitized))
    .catch((error) => {
      console.error("Failed to write audit log:", error);
    });
}

/**
 * Awaits every queued write issued so far. `logAudit` is fire-and-forget by
 * design (callers must not block on disk I/O), so tests that need to assert
 * on file contents immediately after logging should `await flushAuditLog()`
 * first to avoid racing the write queue.
 */
export function flushAuditLog(): Promise<void> {
  return writeQueue;
}
