/**
 * Today Dashboard v2 storage helpers (M0-D):
 *  - actorInitialsFor: pure formatting helper for a user's initials.
 *  - appendJobEvent: low-level insert into job_events (keyed by jobOrderId).
 *  - getAttemptSummaries: batched per-jobOrderId summary of attempt_* events.
 *  - snoozeJob: sets jobs.snoozedUntil/snoozeReason, logs a `snoozed` event,
 *    and (only when a reason is given) writes a job comment.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-job-events-storage-"));
const TEST_DB_PATH = path.join(TEST_DIR, "job-events-storage.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DELETE FROM job_events;
    DELETE FROM job_comments;
    DELETE FROM job_status_history;
    DELETE FROM jobs;
    DELETE FROM users;
    DELETE FROM offices;
  `);
  sqlite.pragma("foreign_keys = ON");
}

test.beforeEach(() => {
  resetDb();
});

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function seedOfficeUserJob(suffix: string) {
  const office = await storage.createOffice({ name: `JES Office ${suffix}` });
  const user = await storage.createUser({
    email: `jes-${suffix}@example.com`,
    loginId: `jes-${suffix}`,
    password: "hash",
    firstName: "Ann",
    lastName: "Ortiz",
    role: "owner",
    officeId: office.id,
  } as any);
  const job = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: `Test${suffix}`,
    jobType: "glasses",
    status: "job_created",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);
  return { office, user, job };
}

test("actorInitialsFor: uppercases first+last initial", () => {
  const initials = (storage as any).actorInitialsFor({ firstName: "ann", lastName: "ortiz" });
  assert.equal(initials, "AO");
});

test("actorInitialsFor: falls back to '' for missing first/last name", () => {
  assert.equal((storage as any).actorInitialsFor({ firstName: null, lastName: undefined }), "");
  assert.equal((storage as any).actorInitialsFor({ firstName: "Ann" }), "A");
  assert.equal((storage as any).actorInitialsFor({ lastName: "Ortiz" }), "O");
  assert.equal((storage as any).actorInitialsFor({}), "");
});

test("appendJobEvent: inserts one job_events row, readable back by jobOrderId", async () => {
  const { office, user, job } = await seedOfficeUserJob("append");

  await (storage as any).appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_called",
    actorUserId: user.id,
    actorInitials: "AO",
    payload: { note: "left voicemail" },
  });

  // Use raw sqlite for a precise, dependency-free read-back.
  const row = sqlite
    .prepare(`SELECT * FROM job_events WHERE job_order_id = ?`)
    .get(job.orderId) as any;

  assert.ok(row, "expected a job_events row for this jobOrderId");
  assert.equal(row.job_id, job.id);
  assert.equal(row.office_id, office.id);
  assert.equal(row.event_type, "attempt_called");
  assert.equal(row.actor_user_id, user.id);
  assert.equal(row.actor_initials, "AO");
  assert.deepEqual(JSON.parse(row.payload), { note: "left voicemail" });
});

test("getAttemptSummaries: omits jobOrderIds with zero attempts", async () => {
  const { office, job } = await seedOfficeUserJob("zero");
  const summaries = await (storage as any).getAttemptSummaries(office.id, [job.orderId]);
  assert.deepEqual(summaries, {});
});

test("getAttemptSummaries: counts + picks most-recent attempt across two jobOrderIds", async () => {
  const { office, user, job } = await seedOfficeUserJob("multi");
  const { job: job2 } = await seedOfficeUserJob("multi2");
  // job2 belongs to a different office in this helper, so re-seed a second
  // job under the SAME office to test batching across jobOrderIds properly.
  const job2Same = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "Second",
    jobType: "glasses",
    status: "job_created",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);

  // job: two attempts, most recent is "texted"
  await (storage as any).appendJobEvent({
    jobOrderId: job.orderId, jobId: job.id, officeId: office.id,
    eventType: "attempt_called", actorUserId: user.id, actorInitials: "AO",
    payload: null,
  });
  // job_events.created_at defaults to `unixepoch() * 1000` (second-granularity),
  // so a sub-second gap wouldn't produce a distinct timestamp — sleep past a
  // full second boundary to make the "most recent" ordering unambiguous.
  await new Promise((r) => setTimeout(r, 1100));
  await (storage as any).appendJobEvent({
    jobOrderId: job.orderId, jobId: job.id, officeId: office.id,
    eventType: "attempt_texted", actorUserId: user.id, actorInitials: "BZ",
    payload: null,
  });

  // job2Same: one attempt, "called"
  await (storage as any).appendJobEvent({
    jobOrderId: job2Same.orderId, jobId: job2Same.id, officeId: office.id,
    eventType: "attempt_called", actorUserId: user.id, actorInitials: "CQ",
    payload: null,
  });

  const summaries = await (storage as any).getAttemptSummaries(office.id, [
    job.orderId,
    job2Same.orderId,
  ]);

  assert.equal(summaries[job.orderId].count, 2);
  assert.equal(summaries[job.orderId].lastType, "texted");
  assert.equal(summaries[job.orderId].lastActorInitials, "BZ");
  assert.ok(typeof summaries[job.orderId].lastAt === "number" && summaries[job.orderId].lastAt > 0);

  assert.equal(summaries[job2Same.orderId].count, 1);
  assert.equal(summaries[job2Same.orderId].lastType, "called");
  assert.equal(summaries[job2Same.orderId].lastActorInitials, "CQ");

  // job2 (different office) must not leak in even though not requested.
  assert.equal(summaries[job2.orderId], undefined);
});

test("snoozeJob: sets snoozedUntil/snoozeReason and logs a snoozed event", async () => {
  const { office, user, job } = await seedOfficeUserJob("snooze1");
  const until = Date.now() + 60 * 60 * 1000;

  await storage.snoozeJob(job.id, until, "waiting on lab", { userId: user.id, initials: "AO" });

  const updated = await storage.getJob(job.id);
  assert.ok(updated);
  assert.equal(updated!.snoozedUntil?.getTime(), until);
  assert.equal(updated!.snoozeReason, "waiting on lab");

  const eventRow = sqlite
    .prepare(`SELECT * FROM job_events WHERE job_order_id = ? AND event_type = 'snoozed'`)
    .get(job.orderId) as any;
  assert.ok(eventRow, "expected a snoozed job_event");
  assert.equal(eventRow.office_id, office.id);
  assert.equal(eventRow.actor_user_id, user.id);
  assert.equal(eventRow.actor_initials, "AO");
  const payload = JSON.parse(eventRow.payload);
  assert.equal(payload.until, until);
  assert.equal(payload.reason, "waiting on lab");
});

test("snoozeJob: writes a job comment only when a non-empty reason is given", async () => {
  const { user, job } = await seedOfficeUserJob("snooze2");
  const until = Date.now() + 60 * 60 * 1000;

  await storage.snoozeJob(job.id, until, "needs new frames", { userId: user.id, initials: "AO" });
  const commentsWithReason = await storage.getJobComments(job.id);
  assert.equal(commentsWithReason.length, 1);
  assert.equal(commentsWithReason[0].content, "needs new frames");
  assert.equal(commentsWithReason[0].authorId, user.id);
});

test("snoozeJob: no comment written when reason is undefined or empty string", async () => {
  const { user, job } = await seedOfficeUserJob("snooze3");
  const until = Date.now() + 60 * 60 * 1000;

  await storage.snoozeJob(job.id, until, undefined, { userId: user.id, initials: "AO" });
  let comments = await storage.getJobComments(job.id);
  assert.equal(comments.length, 0);

  const { job: job2 } = await seedOfficeUserJob("snooze4");
  await storage.snoozeJob(job2.id, until, "", { userId: user.id, initials: "AO" });
  comments = await storage.getJobComments(job2.id);
  assert.equal(comments.length, 0);
});
