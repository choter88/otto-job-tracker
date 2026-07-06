/**
 * getActivityFeed extension for Today Dashboard v2 (M0-D).
 *
 * When the `types` filter includes "attempt" and/or "snooze", getActivityFeed
 * also produces ActivityFeedItems from job_events:
 *  - attempt_called/attempt_texted -> type: "attempt", verb "called"/"texted"
 *  - snoozed -> type: "snooze", verb "snoozed"
 * Both carry actor initials from job_events.actorInitials and inner-join
 * jobs (active-jobs-only by design). Existing types (comment/status_change/
 * overdue/star_note) must be unchanged.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-activity-feed-events-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "activity-feed-events.sqlite");

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

async function seedOfficeUserJob(suffix: string) {
  const office = await storage.createOffice({ name: `Activity Feed Events Office ${suffix}` });
  const user = await storage.createUser({
    email: `afe-${suffix}@example.com`,
    loginId: `afe-${suffix}`,
    password: "hash",
    firstName: "Nina",
    lastName: "Ortega",
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

test("getActivityFeed emits an attempt item (called) with actor initials + jobLabel", async () => {
  const { office, user, job } = await seedOfficeUserJob("attempt-called");
  const since = Date.now() - 60_000;

  await storage.appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_called",
    actorUserId: user.id,
    actorInitials: "NO",
    payload: { note: "left voicemail" },
  });

  const feed = await storage.getActivityFeed(office.id, since, ["attempt"] as any);
  const attemptItems = feed.filter((i) => i.type === "attempt");
  assert.equal(attemptItems.length, 1, "expected exactly one attempt item");
  const item = attemptItems[0];
  assert.equal(item.verb, "called");
  assert.equal(item.jobId, job.id);
  assert.ok(item.jobLabel.includes("Pat"), `jobLabel should include patient name, got "${item.jobLabel}"`);
  assert.equal(item.detail, "left voicemail");
  assert.ok(item.actor, "expected a non-null actor");
  // actor initials must be recoverable as "NO" via firstName[0]+lastName[0]
  // (keeps the existing client badge code, which derives initials this
  // way, working unmodified for the new event-sourced item types).
  const derivedInitials = `${item.actor!.firstName[0] ?? ""}${item.actor!.lastName[0] ?? ""}`;
  assert.equal(derivedInitials, "NO");
});

test("getActivityFeed emits an attempt item (texted) with verb 'texted'", async () => {
  const { office, user, job } = await seedOfficeUserJob("attempt-texted");
  const since = Date.now() - 60_000;

  await storage.appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_texted",
    actorUserId: user.id,
    actorInitials: "NO",
    payload: null,
  });

  const feed = await storage.getActivityFeed(office.id, since, ["attempt"] as any);
  const attemptItems = feed.filter((i) => i.type === "attempt");
  assert.equal(attemptItems.length, 1);
  assert.equal(attemptItems[0].verb, "texted");
});

test("getActivityFeed emits a snooze item with verb 'snoozed'", async () => {
  const { office, user, job } = await seedOfficeUserJob("snooze");
  const since = Date.now() - 60_000;

  await storage.snoozeJob(job.id, Date.now() + 3600_000, "waiting on insurance", {
    userId: user.id,
    initials: "NO",
  });

  const feed = await storage.getActivityFeed(office.id, since, ["snooze"] as any);
  const snoozeItems = feed.filter((i) => i.type === "snooze");
  assert.equal(snoozeItems.length, 1, "expected exactly one snooze item");
  assert.equal(snoozeItems[0].verb, "snoozed");
  assert.ok(snoozeItems[0].jobLabel.includes("Pat"));
});

test("getActivityFeed omits attempt/snooze items when those types are not requested", async () => {
  const { office, user, job } = await seedOfficeUserJob("filtered-out");
  const since = Date.now() - 60_000;

  await storage.appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_called",
    actorUserId: user.id,
    actorInitials: "NO",
    payload: null,
  });

  const feed = await storage.getActivityFeed(office.id, since, ["comment"] as any);
  assert.equal(feed.filter((i) => i.type === "attempt").length, 0);
  assert.equal(feed.filter((i) => i.type === "snooze").length, 0);
});

test("getActivityFeed: attempt/snooze events for jobs no longer active (archived) are dropped (active-jobs-only by design)", async () => {
  const { office, user, job } = await seedOfficeUserJob("archived-drop");
  const since = Date.now() - 60_000;

  await storage.appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_called",
    actorUserId: user.id,
    actorInitials: "NO",
    payload: null,
  });

  // Archive + delete the active job row (job_events survives, keyed by
  // jobOrderId, but the inner join to `jobs` in the feed query means this
  // event drops out of the ACTIVE feed — acceptable per design).
  await storage.archiveJob(job);
  await storage.deleteJob(job.id);

  const feed = await storage.getActivityFeed(office.id, since, ["attempt"] as any);
  assert.equal(feed.filter((i) => i.jobId === job.id).length, 0);
});

test("getActivityFeed: existing types (comment/status_change/overdue/star_note) remain unchanged", async () => {
  const { office, user, job } = await seedOfficeUserJob("existing-types");
  // `since` is taken AFTER job creation (createJob itself writes an initial
  // null -> job_created status_history row) so only the comment + the
  // updateJob call below land in the feed window. created_at/changed_at
  // default to second-precision (unixepoch() * 1000), so back `since` off
  // by a full second to avoid a same-second false negative on the `gt` filter.
  await new Promise((r) => setTimeout(r, 1100));
  const since = Date.now() - 1000;

  await storage.createJobComment({
    jobId: job.id,
    authorId: user.id,
    content: "a normal comment",
  } as any);

  await storage.updateJob(job.id, { status: "ordered" } as any, user.id);

  const feed = await storage.getActivityFeed(office.id, since, ["comment", "status_change"] as any);
  const commentItems = feed.filter((i) => i.type === "comment");
  const statusItems = feed.filter((i) => i.type === "status_change");
  assert.equal(commentItems.length, 1);
  assert.equal(commentItems[0].detail, "a normal comment");
  assert.equal(statusItems.length, 1);
  assert.ok(statusItems[0].verb.startsWith("moved to"));
});
