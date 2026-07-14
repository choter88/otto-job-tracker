/**
 * HIPAA requires 6 years of audit retention. audit-logger.ts used to drop
 * entries once they aged past OTTO_AUDIT_LOG_RETENTION_DAYS or the log grew
 * past OTTO_AUDIT_LOG_MAX_BYTES — both paths permanently destroyed audit
 * records. This test pins the replacement behavior: once the active log
 * exceeds the size cap, it is rolled over (renamed) into a timestamped
 * archive file that is kept forever, and logging continues into a fresh
 * audit_log.jsonl. No entry is ever dropped, only relocated.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-audit-retention-"));
process.env.OTTO_DATA_DIR = TEST_DIR;
process.env.OTTO_AUDIT_LOG_MAX_BYTES = "400";
delete process.env.OTTO_AUDIT_LOG_PATH;

const { logAudit, flushAuditLog } = await import("../server/audit-logger");

test.after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("rollover preserves every audit entry — nothing is ever dropped", async () => {
  const ENTRY_COUNT = 50;
  for (let i = 0; i < ENTRY_COUNT; i += 1) {
    logAudit({
      timestamp: new Date().toISOString(),
      method: "GET",
      path: `/api/jobs/${i}`,
      statusCode: 200,
      durationMs: 1,
      outcome: "success",
    });
  }

  await flushAuditLog();

  const files = fs.readdirSync(TEST_DIR).filter((f) => f.startsWith("audit_log"));

  // The rollover must actually have been exercised for this test to prove
  // anything — otherwise it's just asserting appendFile works.
  assert.ok(files.length > 1, `expected multiple audit_log*.jsonl files (rollover), got: ${files.join(", ")}`);

  const totalLines = files
    .flatMap((f) => fs.readFileSync(path.join(TEST_DIR, f), "utf-8").trim().split("\n"))
    .filter((line) => line.length > 0).length;

  assert.equal(totalLines, ENTRY_COUNT, "every logged entry must survive across the active log + archives");
});

test("archive files are never touched by later writes (kept forever)", async () => {
  const files = fs.readdirSync(TEST_DIR).filter((f) => f.startsWith("audit_log") && f !== "audit_log.jsonl");
  assert.ok(files.length > 0, "expected at least one archive file from the previous test");

  const archived = files.map((f) => fs.readFileSync(path.join(TEST_DIR, f), "utf-8"));

  logAudit({
    timestamp: new Date().toISOString(),
    method: "GET",
    path: "/api/jobs/extra",
    statusCode: 200,
    durationMs: 1,
    outcome: "success",
  });
  await flushAuditLog();

  const archivedAfter = files.map((f) => fs.readFileSync(path.join(TEST_DIR, f), "utf-8"));
  assert.deepEqual(archivedAfter, archived, "archive files must be immutable once rolled over");
});
