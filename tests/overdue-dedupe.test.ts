/**
 * getOverdueJobs dedupe (M0-D).
 *
 * Previously, getOverdueJobs pushed a job once per matching ENABLED
 * notification rule — a job whose status matches two enabled rules (e.g.
 * one office-wide rule and one narrower rule on the same status) appeared
 * twice in the array, double-counting it in the sidebar badge, the overdue
 * page, and the StatsTile. This pins that each job now appears at most
 * once, keeping the WORST rule (largest daysOverdue; tie-break: smallest
 * maxDays).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-overdue-dedupe-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "overdue-dedupe.sqlite");

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

async function seedOfficeUser(suffix: string) {
  const office = await storage.createOffice({ name: `Overdue Dedupe Office ${suffix}` });
  const user = await storage.createUser({
    email: `od-${suffix}@example.com`,
    loginId: `od-${suffix}`,
    password: "hash",
    firstName: "Ray",
    lastName: "Kim",
    role: "owner",
    officeId: office.id,
  } as any);
  return { office, user };
}

test("getOverdueJobs returns a job exactly once when two enabled rules match the same status", async () => {
  const { office, user } = await seedOfficeUser("two-rules");

  // Two enabled rules on the SAME status with different thresholds.
  await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 1,
    enabled: true,
  } as any);
  await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 3,
    enabled: true,
  } as any);

  const job = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "Overdue",
    jobType: "glasses",
    status: "ordered",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);

  // Push statusChangedAt 10 days into the past so it's past BOTH thresholds.
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  sqlite
    .prepare(`UPDATE jobs SET status_changed_at = ? WHERE id = ?`)
    .run(tenDaysAgo.getTime(), job.id);

  const overdue = await storage.getOverdueJobs(office.id);
  const matches = overdue.filter((j: any) => j.id === job.id);
  assert.equal(matches.length, 1, `expected job to appear exactly once, got ${matches.length}`);

  // Keeps the WORST rule: largest daysOverdue means the maxDays=1 rule
  // (more days elapsed past its threshold) — assert the kept rule's
  // maxDays is the smaller of the two (tie-break rule) OR whichever
  // yields the larger daysOverdue. Since both rules see the same
  // statusChangedAt, maxDays=1 produces a strictly larger daysOverdue.
  assert.equal(matches[0].rule.maxDays, 1, "expected the rule producing the larger daysOverdue to be kept");
});

test("getOverdueJobs still returns distinct jobs matching different rules normally", async () => {
  const { office, user } = await seedOfficeUser("distinct");

  await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 1,
    enabled: true,
  } as any);
  await storage.createNotificationRule({
    officeId: office.id,
    status: "in_progress",
    maxDays: 1,
    enabled: true,
  } as any);

  const jobA = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "A",
    jobType: "glasses",
    status: "ordered",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);
  const jobB = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "B",
    jobType: "glasses",
    status: "in_progress",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  sqlite.prepare(`UPDATE jobs SET status_changed_at = ? WHERE id = ?`).run(fiveDaysAgo.getTime(), jobA.id);
  sqlite.prepare(`UPDATE jobs SET status_changed_at = ? WHERE id = ?`).run(fiveDaysAgo.getTime(), jobB.id);

  const overdue = await storage.getOverdueJobs(office.id);
  const ids = overdue.map((j: any) => j.id);
  assert.ok(ids.includes(jobA.id));
  assert.ok(ids.includes(jobB.id));
  assert.equal(ids.filter((id: string) => id === jobA.id).length, 1);
  assert.equal(ids.filter((id: string) => id === jobB.id).length, 1);
});

test("getOverdueJobs disabled rules are still ignored (pre-existing behavior)", async () => {
  const { office, user } = await seedOfficeUser("disabled");

  await storage.createNotificationRule({
    officeId: office.id,
    status: "ordered",
    maxDays: 1,
    enabled: false,
  } as any);

  const job = await storage.createJob({
    patientFirstName: "Pat",
    patientLastName: "Disabled",
    jobType: "glasses",
    status: "ordered",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  sqlite.prepare(`UPDATE jobs SET status_changed_at = ? WHERE id = ?`).run(tenDaysAgo.getTime(), job.id);

  const overdue = await storage.getOverdueJobs(office.id);
  assert.equal(overdue.filter((j: any) => j.id === job.id).length, 0);
});
