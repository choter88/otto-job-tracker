/**
 * HIPAA requires 6 years of audit retention. audit-logger.ts already never
 * deletes audit entries (rollover, not deletion — see audit-retention.test.ts),
 * but a client uninstall/reset (desktop/main.js's `otto:client:release`
 * handler) recursively wipes the whole data dir those files live in. This
 * test pins the helper that copies audit_log*.jsonl out of harm's way
 * BEFORE that wipe runs, and that it leaves unrelated files behind.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { preserveAuditLogs } from "../desktop/lib/audit-preserve.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("copies every audit_log*.jsonl file into destDir and returns their names", () => {
  const dataDir = makeTmpDir("otto-audit-src-");
  const destDir = path.join(makeTmpDir("otto-audit-dest-"), "preserved-audit-logs");

  fs.writeFileSync(path.join(dataDir, "audit_log.jsonl"), '{"a":1}\n');
  fs.writeFileSync(path.join(dataDir, "audit_log.20260101T000000000Z-1.jsonl"), '{"a":2}\n');
  fs.writeFileSync(path.join(dataDir, "otto.sqlite"), "not an audit log");
  fs.writeFileSync(path.join(dataDir, "unrelated.txt"), "should not be preserved");

  const copied = preserveAuditLogs(dataDir, destDir);

  assert.deepEqual(copied.sort(), ["audit_log.20260101T000000000Z-1.jsonl", "audit_log.jsonl"]);

  const destFiles = fs.readdirSync(destDir).sort();
  assert.deepEqual(destFiles, ["audit_log.20260101T000000000Z-1.jsonl", "audit_log.jsonl"]);
  assert.equal(fs.existsSync(path.join(destDir, "otto.sqlite")), false, "sqlite must not be preserved");
  assert.equal(fs.existsSync(path.join(destDir, "unrelated.txt")), false, "unrelated file must not be preserved");

  assert.equal(fs.readFileSync(path.join(destDir, "audit_log.jsonl"), "utf8"), '{"a":1}\n');
  assert.equal(
    fs.readFileSync(path.join(destDir, "audit_log.20260101T000000000Z-1.jsonl"), "utf8"),
    '{"a":2}\n',
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(destDir), { recursive: true, force: true });
});

test("creates destDir with mode 0700 when audit files exist", { skip: process.platform === "win32" }, () => {
  const dataDir = makeTmpDir("otto-audit-src2-");
  const destDir = path.join(makeTmpDir("otto-audit-dest2-"), "preserved-audit-logs");
  fs.writeFileSync(path.join(dataDir, "audit_log.jsonl"), "{}\n");

  preserveAuditLogs(dataDir, destDir);

  const mode = fs.statSync(destDir).mode & 0o777;
  assert.equal(mode, 0o700, `expected mode 0700, got 0${mode.toString(8)}`);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(destDir), { recursive: true, force: true });
});

test("does not create destDir when there are no audit files to copy", () => {
  const dataDir = makeTmpDir("otto-audit-src3-");
  const destParent = makeTmpDir("otto-audit-dest3-");
  const destDir = path.join(destParent, "preserved-audit-logs");
  fs.writeFileSync(path.join(dataDir, "otto.sqlite"), "no audit logs here");

  const copied = preserveAuditLogs(dataDir, destDir);

  assert.deepEqual(copied, []);
  assert.equal(fs.existsSync(destDir), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(destParent, { recursive: true, force: true });
});

test("missing dataDir returns an empty array instead of throwing", () => {
  const destParent = makeTmpDir("otto-audit-dest4-");
  const destDir = path.join(destParent, "preserved-audit-logs");
  const missingDataDir = path.join(destParent, "does-not-exist");

  const copied = preserveAuditLogs(missingDataDir, destDir);

  assert.deepEqual(copied, []);
  assert.equal(fs.existsSync(destDir), false);

  fs.rmSync(destParent, { recursive: true, force: true });
});
