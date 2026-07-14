import fs from "fs";
import path from "path";

const AUDIT_LOG_PATTERN = /^audit_log.*\.jsonl$/;

/**
 * Copy every audit_log*.jsonl file (the active log plus any rolled-over
 * archives — see server/audit-logger.ts) out of dataDir and into destDir.
 *
 * HIPAA requires 6 years of audit retention, and audit-logger.ts already
 * guarantees no entry is ever dropped while the app runs (rollover, not
 * deletion). But a client uninstall/reset wipes the WHOLE data dir those
 * logs live in — desktop/main.js's `otto:client:release` handler
 * recursively `rm`s every top-level userData entry, and the audit logs are
 * nested inside `<userData>/data/`, not a top-level entry of their own. So
 * this must run BEFORE that wipe and copy the logs somewhere the wipe
 * skips.
 *
 * destDir is created (mode 0700) if it doesn't exist, but ONLY when there
 * is at least one audit file to copy — mirrors the "skip entirely when
 * there's nothing to carry" behavior of the attachments backup sidecar.
 * Best-effort per file: one locked/unreadable file doesn't abort the rest.
 * Returns the filenames copied.
 */
export function preserveAuditLogs(dataDir, destDir) {
  let entries;
  try {
    entries = fs.readdirSync(dataDir);
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const auditFiles = entries.filter((name) => AUDIT_LOG_PATTERN.test(name));
  if (auditFiles.length === 0) return [];

  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

  const copied = [];
  for (const name of auditFiles) {
    const src = path.join(dataDir, name);
    try {
      if (!fs.statSync(src).isFile()) continue;
      const dest = path.join(destDir, name);
      fs.copyFileSync(src, dest);
      try {
        fs.chmodSync(dest, 0o600);
      } catch {
        // best-effort on filesystems that don't carry POSIX modes
      }
      copied.push(name);
    } catch (err) {
      console.error(`[audit-preserve] failed to copy ${src}:`, err?.message || err);
    }
  }
  return copied;
}
