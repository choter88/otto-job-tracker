/**
 * Audit logs (audit_log*.jsonl — see server/audit-logger.ts) ride along
 * with every backup as a retained forensic snapshot, the same way
 * order-sheet/job attachments do (tests/backup-attachments.test.ts).
 *
 * copyAuditLogsForBackup gives audit_log*.jsonl its own sidecar next to
 * the .sqlite (parallel to the attachments sidecar) rather than folding
 * into ATTACHMENT_CATEGORIES, because audit logs are flat files directly
 * under the data dir, not a subdirectory restore expects to wipe/replace.
 *
 * Two things this sidecar is NOT:
 *  - It is not the HIPAA system of record. That's the live rolled
 *    audit_log*.jsonl files (+ archives) on the Host, which are never
 *    deleted and independently satisfy the 6-year retention requirement.
 *  - It is not auto-restored. Restore only reads back the .sqlite and
 *    attachment sidecars; the audit sidecar is a manual disaster-recovery
 *    artifact only (see the comment above AUDIT_LOG_SUFFIX in
 *    desktop/lib/backup.js).
 *
 * What IS pinned here: the sidecar is created correctly, and — like the
 * attachment sidecars — it is pruned by enforceBackupRetention alongside
 * its paired .sqlite, so the per-cycle sidecars don't grow disk usage
 * without bound.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  copyAuditLogsForBackup,
  enforceBackupRetention,
  formatBackupTimestamp,
  getAuditLogSidecarPath,
  removeAttachmentSidecar,
} from "../desktop/lib/backup.js";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("getAuditLogSidecarPath derives a stable, paired name from the backup file", () => {
  const got = getAuditLogSidecarPath("/backups/otto-backup-2026-07-14-080000-123.sqlite");
  assert.equal(got, path.join("/backups", "otto-backup-2026-07-14-080000-123-audit"));
});

test("backup copies audit_log.jsonl (and archives) into the backup output", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-07-14-080000-001.sqlite");
  fs.writeFileSync(backupFile, "fake sqlite contents"); // stand-in for db.backup() output

  fs.writeFileSync(path.join(dataDir, "audit_log.jsonl"), '{"a":1}\n');
  fs.writeFileSync(path.join(dataDir, "audit_log.20260701T000000000Z-1.jsonl"), '{"a":2}\n');
  fs.writeFileSync(path.join(dataDir, "otto.sqlite"), "not an audit log");

  const copied = copyAuditLogsForBackup(backupFile, dataDir);
  assert.deepEqual(copied.sort(), ["audit_log.20260701T000000000Z-1.jsonl", "audit_log.jsonl"]);

  const sidecar = getAuditLogSidecarPath(backupFile);
  const sidecarFiles = fs.readdirSync(sidecar).sort();
  assert.deepEqual(sidecarFiles, ["audit_log.20260701T000000000Z-1.jsonl", "audit_log.jsonl"]);
  assert.equal(fs.existsSync(path.join(sidecar, "otto.sqlite")), false);

  assert.equal(fs.readFileSync(path.join(sidecar, "audit_log.jsonl"), "utf8"), '{"a":1}\n');

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("no audit logs in the data dir means no sidecar is created", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-07-14-080000-002.sqlite");
  fs.writeFileSync(backupFile, "sqlite");

  const copied = copyAuditLogsForBackup(backupFile, dataDir);
  assert.deepEqual(copied, []);
  assert.equal(fs.existsSync(getAuditLogSidecarPath(backupFile)), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("removeAttachmentSidecar also prunes the audit sidecar", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");
  const backupFile = path.join(backupDir, "otto-backup-2026-07-14-080000-003.sqlite");
  fs.writeFileSync(backupFile, "sqlite");

  fs.writeFileSync(path.join(dataDir, "audit_log.jsonl"), '{"a":1}\n');
  copyAuditLogsForBackup(backupFile, dataDir);
  assert.equal(fs.existsSync(getAuditLogSidecarPath(backupFile)), true);

  removeAttachmentSidecar(backupFile);
  assert.equal(fs.existsSync(getAuditLogSidecarPath(backupFile)), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("retention prunes the audit sidecar alongside an old .sqlite (no unbounded growth)", () => {
  const dataDir = makeTmpDir("otto-data-");
  const backupDir = makeTmpDir("otto-backup-dir-");

  // Mirrors tests/backup-attachments.test.ts "retention prunes the sidecar
  // alongside the .sqlite" — one ancient (well past the 30-day archive
  // window) backup, one recent (well inside it). Retention must delete the
  // ancient audit sidecar with its .sqlite, or the per-cycle
  // otto-backup-<ts>-audit/ sidecars leak disk forever. Timestamps are
  // relative to "now" (not hardcoded calendar dates) so this doesn't flake
  // as the current date advances.
  const ancientTs = formatBackupTimestamp(new Date(Date.now() - 40 * ONE_DAY_MS));
  const recentTs = formatBackupTimestamp(new Date(Date.now() - 2 * ONE_DAY_MS));
  const ancient = path.join(backupDir, `otto-backup-${ancientTs}.sqlite`);
  const recent = path.join(backupDir, `otto-backup-${recentTs}.sqlite`);
  fs.writeFileSync(ancient, "old sqlite");
  fs.writeFileSync(recent, "new sqlite");

  fs.writeFileSync(path.join(dataDir, "audit_log.jsonl"), '{"a":1}\n');
  copyAuditLogsForBackup(ancient, dataDir);
  copyAuditLogsForBackup(recent, dataDir);

  assert.equal(fs.existsSync(getAuditLogSidecarPath(ancient)), true);
  assert.equal(fs.existsSync(getAuditLogSidecarPath(recent)), true);

  enforceBackupRetention(backupDir);

  // Ancient sqlite AND its audit sidecar are gone; recent pair survives.
  assert.equal(fs.existsSync(ancient), false, "ancient .sqlite should be pruned");
  assert.equal(fs.existsSync(getAuditLogSidecarPath(ancient)), false, "ancient audit sidecar should be pruned");
  assert.equal(fs.existsSync(recent), true, "recent .sqlite must survive");
  assert.equal(fs.existsSync(getAuditLogSidecarPath(recent)), true, "recent audit sidecar must survive");

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});
