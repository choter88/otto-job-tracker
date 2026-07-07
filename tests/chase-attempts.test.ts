/**
 * Today Dashboard v2 (M1): storage.logChaseAttempts.
 *
 * For each jobOrderId belonging to `officeId`, appends a `chase_attempt`
 * job_events row (payload { destinationId }) with the given actor. jobOrderIds
 * that don't belong to the office (wrong office, or no matching job at all)
 * are skipped. Returns { count: number of events actually written }.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-chase-attempts-"));
const TEST_DB_PATH = path.join(TEST_DIR, "chase-attempts.sqlite");

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

async function seedOfficeUser(suffix: string) {
  const office = await storage.createOffice({ name: `Chase Office ${suffix}` });
  const user = await storage.createUser({
    email: `chase-${suffix}@example.com`,
    loginId: `chase-${suffix}`,
    password: "hash",
    firstName: "Ann",
    lastName: "Ortiz",
    role: "owner",
    officeId: office.id,
  } as any);
  return { office, user };
}

async function makeJob(officeId: string, userId: string, suffix: string) {
  return storage.createJob({
    patientFirstName: "Pat",
    patientLastName: `Test${suffix}`,
    jobType: "glasses",
    status: "job_created",
    orderDestination: "vision_lab",
    officeId,
    createdBy: userId,
  } as any);
}

test("logChaseAttempts: writes one chase_attempt event per jobOrderId, with actor + destinationId", async () => {
  const { office, user } = await seedOfficeUser("basic");
  const job1 = await makeJob(office.id, user.id, "1");
  const job2 = await makeJob(office.id, user.id, "2");
  const job3 = await makeJob(office.id, user.id, "3");

  const actor = { userId: user.id, initials: "AO" };
  const result = await (storage as any).logChaseAttempts(
    office.id,
    [job1.orderId, job2.orderId, job3.orderId],
    "vision_lab",
    actor,
  );

  assert.equal(result.count, 3);

  const rows = sqlite
    .prepare(`SELECT * FROM job_events WHERE event_type = 'chase_attempt' ORDER BY job_order_id`)
    .all() as any[];
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.actor_user_id, user.id);
    assert.equal(row.actor_initials, "AO");
    assert.equal(row.office_id, office.id);
    const payload = JSON.parse(row.payload);
    assert.deepEqual(payload, { destinationId: "vision_lab" });
  }

  const orderIds = rows.map((r) => r.job_order_id).sort();
  assert.deepEqual(orderIds, [job1.orderId, job2.orderId, job3.orderId].sort());
});

test("logChaseAttempts: best-effort looks up jobId (current jobs.id) by orderId", async () => {
  const { office, user } = await seedOfficeUser("jobid");
  const job = await makeJob(office.id, user.id, "lookup");

  await (storage as any).logChaseAttempts(office.id, [job.orderId], "mail", {
    userId: user.id,
    initials: "AO",
  });

  const row = sqlite
    .prepare(`SELECT * FROM job_events WHERE event_type = 'chase_attempt' AND job_order_id = ?`)
    .get(job.orderId) as any;
  assert.ok(row);
  assert.equal(row.job_id, job.id);
});

test("logChaseAttempts: skips jobOrderIds outside the office and does not count them", async () => {
  const { office: officeA, user: userA } = await seedOfficeUser("iso-a");
  const { office: officeB, user: userB } = await seedOfficeUser("iso-b");
  const jobA = await makeJob(officeA.id, userA.id, "a");
  const jobB = await makeJob(officeB.id, userB.id, "b");

  const actor = { userId: userA.id, initials: "AO" };
  const result = await (storage as any).logChaseAttempts(
    officeA.id,
    [jobA.orderId, jobB.orderId, "nonexistent-order-id"],
    "vision_lab",
    actor,
  );

  assert.equal(result.count, 1, "only jobA's orderId belongs to officeA");

  const rows = sqlite
    .prepare(`SELECT * FROM job_events WHERE event_type = 'chase_attempt'`)
    .all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_order_id, jobA.orderId);
  assert.equal(rows[0].office_id, officeA.id);
});

test("logChaseAttempts: returns count 0 for an empty jobOrderIds array", async () => {
  const { office, user } = await seedOfficeUser("empty");
  const result = await (storage as any).logChaseAttempts(office.id, [], "vision_lab", {
    userId: user.id,
    initials: "AO",
  });
  assert.equal(result.count, 0);
});
