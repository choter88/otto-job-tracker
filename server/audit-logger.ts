import fs from "fs";
import os from "os";
import path from "path";

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
