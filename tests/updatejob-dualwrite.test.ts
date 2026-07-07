/**
 * Today Dashboard v2 status-change dual-write (M0-D).
 *
 * `updateJob` already writes a `job_status_history` row when status changes
 * (FK'd to jobs.id, cascade-deleted when the job row is deleted). This adds
 * an ADDITIVE `status_changed` job_event write, keyed by jobOrderId (not a
 * foreign key), so the event survives the archive+delete that happens when
 * a job's status becomes completed/cancelled.
 *
 * Also covers:
 *  - `today_pickup` usage_event fired exactly when newStatus === 'completed'.
 *  - a manual status change on a snoozed job clears the snooze and logs
 *    `snooze_cleared`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-updatejob-dualwrite-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "updatejob-dualwrite.sqlite");

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function seedOfficeUserJob(suffix: string, status = "job_created") {
  const office = await storage.createOffice({ name: `UJD Office ${suffix}` });
  const user = await storage.createUser({
    email: `ujd-${suffix}@example.com`,
    loginId: `ujd-${suffix}`,
    password: "hash",
    firstName: "Sam",
    lastName: "Reyes",
    role: "owner",
    officeId: office.id,
  } as any);
  const job = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: `Test${suffix}`,
    jobType: "glasses",
    status,
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);
  return { office, user, job };
}

function jobEventRows(jobOrderId: string, eventType?: string): any[] {
  const rows = eventType
    ? sqlite.prepare(`SELECT * FROM job_events WHERE job_order_id = ? AND event_type = ?`).all(jobOrderId, eventType)
    : sqlite.prepare(`SELECT * FROM job_events WHERE job_order_id = ?`).all(jobOrderId);
  return rows as any[];
}

function usageEventRows(eventType: string): any[] {
  return sqlite.prepare(`SELECT * FROM usage_events WHERE event_type = ?`).all(eventType) as any[];
}

test("updateJob: ordered -> in_progress writes a status_changed job_event (additive to job_status_history)", async () => {
  const { user, job } = await seedOfficeUserJob("basic", "ordered");

  const historyBefore = sqlite
    .prepare(`SELECT * FROM job_status_history WHERE job_id = ?`)
    .all(job.id) as any[];

  await storage.updateJob(job.id, { status: "in_progress" } as any, user.id);

  const historyAfter = sqlite
    .prepare(`SELECT * FROM job_status_history WHERE job_id = ?`)
    .all(job.id) as any[];
  assert.ok(historyAfter.length > historyBefore.length, "existing job_status_history write must still happen");

  const events = jobEventRows(job.orderId, "status_changed");
  assert.equal(events.length, 1, "expected exactly one status_changed job_event");
  const payload = JSON.parse(events[0].payload);
  assert.equal(payload.oldStatus, "ordered");
  assert.equal(payload.newStatus, "in_progress");
  assert.equal(events[0].actor_user_id, user.id);
  assert.ok(events[0].actor_initials, "expected actor initials to be set");
});

test("updateJob: -> completed through archive+delete still leaves the status_changed event (keyed by jobOrderId) + records today_pickup", async () => {
  const { office, user, job } = await seedOfficeUserJob("completed", "ready_for_pickup");

  const before = usageEventRows("today_pickup").length;

  const updated = await storage.updateJob(job.id, { status: "completed" } as any, user.id);

  // Simulate the archive+delete path routes.ts runs immediately after
  // updateJob for terminal statuses.
  await storage.archiveJob(updated);
  await storage.deleteJob(updated.id);

  // job row is gone
  assert.equal(await storage.getJob(job.id), undefined);

  // its job_status_history is cascade-deleted (FK'd to jobs.id)
  const history = sqlite.prepare(`SELECT * FROM job_status_history WHERE job_id = ?`).all(job.id) as any[];
  assert.equal(history.length, 0, "job_status_history should be gone after cascade delete");

  // but the job_event (keyed by jobOrderId, not jobs.id) survives
  const events = jobEventRows(job.orderId, "status_changed");
  assert.equal(events.length, 1, "status_changed job_event must survive archive+delete");
  const payload = JSON.parse(events[0].payload);
  assert.equal(payload.oldStatus, "ready_for_pickup");
  assert.equal(payload.newStatus, "completed");

  // today_pickup usage_event recorded exactly once for this transition
  const after = usageEventRows("today_pickup").length;
  assert.equal(after, before + 1, "expected exactly one new today_pickup usage_event");

  const pickupRow = usageEventRows("today_pickup").slice(-1)[0];
  assert.equal(pickupRow.office_id, office.id);
});

test("updateJob: does not record today_pickup for a non-completed transition", async () => {
  const { user, job } = await seedOfficeUserJob("nopickup", "ordered");
  const before = usageEventRows("today_pickup").length;
  await storage.updateJob(job.id, { status: "in_progress" } as any, user.id);
  const after = usageEventRows("today_pickup").length;
  assert.equal(after, before, "today_pickup must only fire for completed transitions");
});

test("updateJob: a manual status change on a snoozed job clears the snooze + logs snooze_cleared", async () => {
  const { user, job } = await seedOfficeUserJob("snoozed", "ordered");

  await storage.snoozeJob(job.id, Date.now() + 60 * 60 * 1000, "waiting on lab", {
    userId: user.id,
    initials: "SR",
  });

  const snoozed = await storage.getJob(job.id);
  assert.ok(snoozed!.snoozedUntil, "job should be snoozed before the status change");

  await storage.updateJob(job.id, { status: "in_progress" } as any, user.id);

  const updated = await storage.getJob(job.id);
  assert.equal(updated!.snoozedUntil, null, "snoozedUntil must be cleared by a manual status change");
  assert.equal(updated!.snoozeReason, null, "snoozeReason must be cleared by a manual status change");

  const clearedEvents = jobEventRows(job.orderId, "snooze_cleared");
  assert.equal(clearedEvents.length, 1, "expected exactly one snooze_cleared job_event");
  const payload = JSON.parse(clearedEvents[0].payload);
  assert.equal(payload.reason, "manual");
});

test("updateJob: a status change on a NON-snoozed job does not write snooze_cleared", async () => {
  const { user, job } = await seedOfficeUserJob("notsnoozed", "ordered");
  await storage.updateJob(job.id, { status: "in_progress" } as any, user.id);
  const clearedEvents = jobEventRows(job.orderId, "snooze_cleared");
  assert.equal(clearedEvents.length, 0);
});
