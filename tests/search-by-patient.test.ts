/**
 * Today Dashboard v2 (M1): storage.searchByPatientName.
 *
 * Case-insensitive match of `q` against patientFirstName / patientLastName /
 * (first+" "+last) over ACTIVE jobs (the `jobs` table — archived jobs live in
 * `archivedJobs` and are never returned here) in a single office.
 *
 *  - jobs: matching active jobs, capped at `limit`.
 *  - patients: distinct (firstName+lastName) among the matches, each with
 *    jobId = that patient's MOST RECENT active job id (there is no patient
 *    detail screen — selecting a patient opens their latest job).
 *  - Empty q short-circuits to {patients:[],jobs:[]} without a query.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-search-by-patient-"));
const TEST_DB_PATH = path.join(TEST_DIR, "search-by-patient.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DELETE FROM job_events;
    DELETE FROM job_comments;
    DELETE FROM job_status_history;
    DELETE FROM archived_jobs;
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

async function seedOffice(suffix: string) {
  const office = await storage.createOffice({ name: `SBP Office ${suffix}` });
  const user = await storage.createUser({
    email: `sbp-${suffix}@example.com`,
    loginId: `sbp-${suffix}`,
    password: "hash",
    firstName: "Ann",
    lastName: "Ortiz",
    role: "owner",
    officeId: office.id,
  } as any);
  return { office, user };
}

async function makeJob(officeId: string, userId: string, overrides: Partial<{
  patientFirstName: string;
  patientLastName: string;
  status: string;
}> = {}) {
  return storage.createJob({
    patientFirstName: overrides.patientFirstName ?? "Pat",
    patientLastName: overrides.patientLastName ?? "Test",
    jobType: "glasses",
    status: overrides.status ?? "job_created",
    orderDestination: "vision_lab",
    officeId,
    createdBy: userId,
  } as any);
}

test("searchByPatientName: empty q short-circuits to {patients:[],jobs:[]}", async () => {
  const { office, user } = await seedOffice("empty");
  await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });

  const result = await (storage as any).searchByPatientName(office.id, "");
  assert.deepEqual(result, { patients: [], jobs: [] });
});

test("searchByPatientName: matches partial first name, case-insensitive", async () => {
  const { office, user } = await seedOffice("first");
  const job = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  await makeJob(office.id, user.id, { patientFirstName: "Bob", patientLastName: "Smith" });

  const result = await (storage as any).searchByPatientName(office.id, "jan");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, job.id);
  assert.equal(result.patients.length, 1);
  assert.equal(result.patients[0].firstName, "Jane");
  assert.equal(result.patients[0].lastName, "Doe");
});

test("searchByPatientName: matches partial last name, case-insensitive", async () => {
  const { office, user } = await seedOffice("last");
  const job = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  await makeJob(office.id, user.id, { patientFirstName: "Bob", patientLastName: "Smith" });

  const result = await (storage as any).searchByPatientName(office.id, "DOE");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, job.id);
});

test("searchByPatientName: matches full name (first+space+last)", async () => {
  const { office, user } = await seedOffice("full");
  const job = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  await makeJob(office.id, user.id, { patientFirstName: "Bob", patientLastName: "Smith" });

  const result = await (storage as any).searchByPatientName(office.id, "jane doe");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, job.id);
});

test("searchByPatientName: groups matches into distinct patients, picking the MOST RECENT active job", async () => {
  const { office, user } = await seedOffice("multi");
  const olderJob = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  // job_events/jobs createdAt default has second-granularity in this schema's
  // sql default; sleep past a full second boundary so "most recent" is unambiguous.
  await new Promise((r) => setTimeout(r, 1100));
  const newerJob = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });

  const result = await (storage as any).searchByPatientName(office.id, "jane");
  assert.equal(result.jobs.length, 2, "both active jobs for this patient should be in jobs[]");

  assert.equal(result.patients.length, 1, "same patient (firstName+lastName) should be deduped in patients[]");
  assert.equal(result.patients[0].jobId, newerJob.id, "patients[].jobId should point at the MOST RECENT active job");
  assert.notEqual(result.patients[0].jobId, olderJob.id);
});

test("searchByPatientName: enforces office isolation", async () => {
  const { office: officeA, user: userA } = await seedOffice("iso-a");
  const { office: officeB, user: userB } = await seedOffice("iso-b");
  await makeJob(officeA.id, userA.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  await makeJob(officeB.id, userB.id, { patientFirstName: "Jane", patientLastName: "Doe" });

  const result = await (storage as any).searchByPatientName(officeA.id, "jane");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].patientFirstName, "Jane");
});

test("searchByPatientName: excludes archived jobs", async () => {
  const { office, user } = await seedOffice("archived");
  const job = await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: "Doe" });
  // Mirror the /api/jobs/:id/archive route: archive (insert into
  // archivedJobs) then delete the active-jobs row.
  await storage.archiveJob({ ...job, status: "completed" } as any);
  await storage.deleteJob(job.id);

  const result = await (storage as any).searchByPatientName(office.id, "jane");
  assert.equal(result.jobs.length, 0);
  assert.equal(result.patients.length, 0);
});

test("searchByPatientName: caps jobs at the given limit", async () => {
  const { office, user } = await seedOffice("limit");
  for (let i = 0; i < 5; i++) {
    await makeJob(office.id, user.id, { patientFirstName: "Jane", patientLastName: `Doe${i}` });
  }

  const result = await (storage as any).searchByPatientName(office.id, "jane", 3);
  assert.equal(result.jobs.length, 3);
});
