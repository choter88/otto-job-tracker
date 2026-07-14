/**
 * Audit logs (audit_log*.jsonl — see server/audit-logger.ts) must ride
 * along with every backup, the same way order-sheet/job attachments do
 * (tests/backup-attachments.test.ts). HIPAA requires 6 years of audit
 * retention; a Host disaster-recovery restore that drops the audit trail
 * would defeat that guarantee just as surely as losing the sqlite would.
 *
 * copyAuditLogsForBackup gives audit_log*.jsonl its own sidecar next to
 * the .sqlite (parallel to the attachments sidecar) rather than folding
 * into ATTACHMENT_CATEGORIES, because audit logs are flat files directly
 * under the data dir, not a subdirectory restore expects to wipe/replace.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  copyAuditLogsForBackup,
  getAuditLogSidecarPath,
} from "../desktop/lib/backup.js";

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
