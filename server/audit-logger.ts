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
const DEFAULT_RETENTION_DAYS = 30;
const COMPACTION_INTERVAL_WRITES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function getAuditLogFilePath(): string {
  if (process.env.OTTO_AUDIT_LOG_PATH) return process.env.OTTO_AUDIT_LOG_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  return path.join(dataDir, "audit_log.jsonl");
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

const LOG_FILE = getAuditLogFilePath();
const MAX_BYTES = parseIntegerEnv("OTTO_AUDIT_LOG_MAX_BYTES", DEFAULT_MAX_BYTES, 1024);
const RETENTION_DAYS = parseIntegerEnv("OTTO_AUDIT_LOG_RETENTION_DAYS", DEFAULT_RETENTION_DAYS, 0);

let writesSinceCompaction = 0;
let writeQueue: Promise<void> = Promise.resolve();

async function compactAuditLogFile(): Promise<void> {
  let content = "";
  try {
    content = await fs.promises.readFile(LOG_FILE, "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const cutoffMs = RETENTION_DAYS > 0 ? Date.now() - RETENTION_DAYS * DAY_MS : null;
  const parsedEntries: AuditLogEntry[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = sanitizeEntry(JSON.parse(line) as AuditLogEntry);
      const parsedMs = Date.parse(parsed.timestamp);
      if (!Number.isFinite(parsedMs)) continue;
      if (cutoffMs !== null && parsedMs < cutoffMs) continue;
      parsedEntries.push(parsed);
    } catch {
      // Skip malformed lines.
    }
  }

  const keptLines: string[] = [];
  let runningBytes = 0;
  for (let i = parsedEntries.length - 1; i >= 0; i -= 1) {
    const line = JSON.stringify(parsedEntries[i]);
    const lineBytes = Buffer.byteLength(line) + 1;
    if (lineBytes > MAX_BYTES) continue;
    if (runningBytes + lineBytes > MAX_BYTES) break;
    keptLines.push(line);
    runningBytes += lineBytes;
  }

  keptLines.reverse();
  const nextContent = keptLines.length > 0 ? `${keptLines.join("\n")}\n` : "";
  await fs.promises.writeFile(LOG_FILE, nextContent, { encoding: "utf-8", mode: 0o600 });
}

async function appendAuditLogEntry(entry: AuditLogEntry): Promise<void> {
  await fs.promises.mkdir(path.dirname(LOG_FILE), { recursive: true, mode: 0o700 });
  await fs.promises.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, { encoding: "utf-8", mode: 0o600 });

  writesSinceCompaction += 1;

  const stats = await fs.promises.stat(LOG_FILE).catch(() => null);
  if (stats && stats.size > MAX_BYTES) {
    writesSinceCompaction = 0;
    await compactAuditLogFile();
    return;
  }

  if (writesSinceCompaction >= COMPACTION_INTERVAL_WRITES) {
    writesSinceCompaction = 0;
    await compactAuditLogFile();
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
