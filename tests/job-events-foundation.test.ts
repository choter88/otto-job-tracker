/**
 * Today Dashboard v2 data foundation:
 *  - job_events: append-only "order event envelope" table, one row per staff
 *    action on a job. Keyed by the stable job_order_id (ORD-… handle), NOT
 *    jobs.id, so events survive archive (same precedent as jobAttachments /
 *    orderSheetImports).
 *  - jobs.snoozed_until / jobs.snooze_reason: additive, nullable columns
 *    used to hide a tile until a timestamp passes.
 *
 * These tests pin the bootstrap shape (fresh-DB path) — the legacy-fixture
 * backcompat guarantee lives in tests/migrate-existing-db.test.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-job-events-foundation-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "job-events-foundation.sqlite");

const { sqlite, db } = await import("../server/db");
const schema = await import("@shared/schema");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function columnNames(table: string): string[] {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

test("job_events table exists with all nine columns", () => {
  const cols = columnNames("job_events");
  const expected = [
    "id",
    "job_order_id",
    "job_id",
    "office_id",
    "event_type",
    "actor_user_id",
    "actor_initials",
    "payload",
    "created_at",
  ];
  for (const col of expected) {
    assert.ok(cols.includes(col), `job_events missing column ${col}; has: ${cols.join(", ")}`);
  }
  assert.equal(cols.length, expected.length, `job_events has unexpected extra columns: ${cols.join(", ")}`);
});

test("jobs table gained snoozed_until and snooze_reason columns", () => {
  const cols = columnNames("jobs");
  assert.ok(cols.includes("snoozed_until"), "jobs missing snoozed_until");
  assert.ok(cols.includes("snooze_reason"), "jobs missing snooze_reason");
});

test("insert + read a job_events row via the drizzle db handle", async () => {
  const office = await db
    .insert(schema.offices)
    .values({ id: "office-jef-1", name: "Job Events Foundation Optical" })
    .returning();
  assert.equal(office.length, 1);

  const user = await db
    .insert(schema.users)
    .values({
      id: "user-jef-1",
      email: "jef-owner@example.com",
      loginId: "jef-owner",
      password: "hash",
      firstName: "Owner",
      lastName: "User",
      role: "owner",
      officeId: "office-jef-1",
    })
    .returning();
  assert.equal(user.length, 1);

  const job = await db
    .insert(schema.jobs)
    .values({
      id: "job-jef-1",
      orderId: "ORD-JEF-0001",
      patientFirstName: "Pat",
      patientLastName: "Test",
      jobType: "glasses",
      status: "job_created",
      orderDestination: "vision_lab",
      officeId: "office-jef-1",
      createdBy: "user-jef-1",
    })
    .returning();
  assert.equal(job.length, 1);

  const inserted = await db
    .insert(schema.jobEvents)
    .values({
      id: "event-jef-1",
      jobOrderId: "ORD-JEF-0001",
      jobId: "job-jef-1",
      officeId: "office-jef-1",
      eventType: "status_changed",
      actorUserId: "user-jef-1",
      actorInitials: "OU",
      payload: { from: "job_created", to: "ordered" },
    })
    .returning();

  assert.equal(inserted.length, 1);

  const readBack = inserted[0];
  assert.equal(readBack.id, "event-jef-1");
  assert.equal(readBack.jobOrderId, "ORD-JEF-0001");
  assert.equal(readBack.jobId, "job-jef-1");
  assert.equal(readBack.officeId, "office-jef-1");
  assert.equal(readBack.eventType, "status_changed");
  assert.equal(readBack.actorUserId, "user-jef-1");
  assert.equal(readBack.actorInitials, "OU");
  assert.deepEqual(readBack.payload, { from: "job_created", to: "ordered" });
  assert.ok(readBack.createdAt instanceof Date);

  // Prove it actually persisted (row survives a re-read from the table).
  const row = sqlite.prepare(`SELECT * FROM job_events WHERE id = ?`).get("event-jef-1") as any;
  assert.ok(row, "job_events row was not persisted");
  assert.equal(row.job_order_id, "ORD-JEF-0001");
  assert.equal(JSON.parse(row.payload).to, "ordered");
});
