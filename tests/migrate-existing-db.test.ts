/**
 * Load-bearing backcompat guarantee (Today Dashboard v2 spec acceptance #8):
 * an existing pre-change Host SQLite db — one that predates job_events and
 * the jobs snooze columns — must open, migrate forward, and keep ALL of its
 * data. Additive migrations only; nothing is dropped, renamed, or mutated.
 *
 * This test hand-builds a LEGACY db file (minimal legacy table shapes only,
 * no job_events, no snooze columns) and seeds realistic rows across offices,
 * users, jobs, job_flags, job_status_history, and job_comments — all BEFORE
 * ../server/db is ever imported. Only after the legacy file exists on disk
 * do we import ../server/db, which runs bootstrapSqliteSchema() against the
 * legacy file and must migrate it in place.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-migrate-existing-db-"));
const TEST_DB_PATH = path.join(TEST_DIR, "legacy.sqlite");
process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const NOW = Date.now();

const LEGACY_OFFICE = {
  id: "legacy-office-1",
  name: "Legacy Optical",
  address: "100 Main St",
  phone: "555-0100",
  email: "legacy@optical.test",
  enabled: 1,
  settings: "{}",
  created_at: NOW - 100000,
  updated_at: NOW - 100000,
};

const LEGACY_USER = {
  id: "legacy-user-1",
  email: "owner@legacy-optical.test",
  login_id: "legacy-owner",
  password: "hashed-password",
  pin_hash: null,
  first_name: "Legacy",
  last_name: "Owner",
  role: "owner",
  office_id: LEGACY_OFFICE.id,
  created_at: NOW - 90000,
  updated_at: NOW - 90000,
};

const LEGACY_STAFF = {
  id: "legacy-user-2",
  email: "staff@legacy-optical.test",
  login_id: "legacy-staff",
  password: "hashed-password-2",
  pin_hash: null,
  first_name: "Legacy",
  last_name: "Staff",
  role: "staff",
  office_id: LEGACY_OFFICE.id,
  created_at: NOW - 80000,
  updated_at: NOW - 80000,
};

const LEGACY_JOB = {
  id: "legacy-job-1",
  order_id: "ORD-LEGACY-0001",
  patient_first_name: "Jane",
  patient_last_name: "Doe",
  tray_number: "T-42",
  phone: "555-0101",
  job_type: "glasses",
  status: "ordered",
  order_destination: "vision_lab",
  office_id: LEGACY_OFFICE.id,
  created_by: LEGACY_USER.id,
  status_changed_at: NOW - 70000,
  custom_column_values: "{}",
  is_redo_job: 0,
  original_job_id: null,
  notes: "Legacy note",
  created_at: NOW - 70000,
  updated_at: NOW - 70000,
};

const LEGACY_JOB_FLAG = {
  id: "legacy-flag-1",
  user_id: LEGACY_USER.id,
  job_id: LEGACY_JOB.id,
  summary: null,
  summary_generated_at: null,
  important_note: "Handle with care",
  important_note_updated_at: NOW - 60000,
  created_at: NOW - 60000,
};

const LEGACY_STATUS_HISTORY = {
  id: "legacy-history-1",
  job_id: LEGACY_JOB.id,
  old_status: "job_created",
  new_status: "ordered",
  changed_by: LEGACY_USER.id,
  changed_at: NOW - 65000,
};

const LEGACY_COMMENT = {
  id: "legacy-comment-1",
  job_id: LEGACY_JOB.id,
  author_id: LEGACY_STAFF.id,
  content: "Called the patient, order confirmed.",
  is_overdue_comment: 0,
  created_at: NOW - 50000,
};

function buildLegacyDb(): void {
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Minimal legacy shapes, cribbed from server/sqlite-bootstrap.ts, WITHOUT
  // job_events and WITHOUT the jobs snooze columns.
  sqlite.exec(`
    CREATE TABLE offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      login_id TEXT UNIQUE,
      password TEXT NOT NULL,
      pin_hash TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      office_id TEXT REFERENCES offices(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      patient_first_name TEXT NOT NULL,
      patient_last_name TEXT NOT NULL,
      tray_number TEXT,
      phone TEXT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'job_created',
      order_destination TEXT NOT NULL,
      office_id TEXT NOT NULL REFERENCES offices(id),
      created_by TEXT REFERENCES users(id),
      status_changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      custom_column_values TEXT NOT NULL DEFAULT '{}',
      is_redo_job INTEGER NOT NULL DEFAULT 0,
      original_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE job_flags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      summary TEXT,
      summary_generated_at INTEGER,
      important_note TEXT,
      important_note_updated_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(user_id, job_id)
    );

    CREATE TABLE job_status_history (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE job_comments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      is_overdue_comment INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  const insert = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    const placeholders = cols.map((c) => `@${c}`).join(", ");
    sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(row);
  };

  insert("offices", LEGACY_OFFICE);
  insert("users", LEGACY_USER);
  insert("users", LEGACY_STAFF);
  insert("jobs", LEGACY_JOB);
  insert("job_flags", LEGACY_JOB_FLAG);
  insert("job_status_history", LEGACY_STATUS_HISTORY);
  insert("job_comments", LEGACY_COMMENT);

  // Sanity check: the legacy db really doesn't have the new table/columns.
  const jobCols = sqlite.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>;
  if (jobCols.some((c) => c.name === "snoozed_until" || c.name === "snooze_reason")) {
    throw new Error("test setup bug: legacy jobs table already has snooze columns");
  }
  const tableExists = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_events'`)
    .get();
  if (tableExists) {
    throw new Error("test setup bug: legacy db already has job_events");
  }

  sqlite.close();
}

// Build the legacy fixture BEFORE importing ../server/db — bootstrap must
// not run until the legacy file is fully written.
buildLegacyDb();

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

test("legacy offices/users/jobs/job_flags/job_status_history/job_comments rows survive migration unchanged", () => {
  const office = sqlite.prepare(`SELECT * FROM offices WHERE id = ?`).get(LEGACY_OFFICE.id) as any;
  assert.ok(office, "legacy office row missing after migration");
  assert.equal(office.name, LEGACY_OFFICE.name);
  assert.equal(office.address, LEGACY_OFFICE.address);
  assert.equal(office.phone, LEGACY_OFFICE.phone);
  assert.equal(office.email, LEGACY_OFFICE.email);
  assert.equal(office.created_at, LEGACY_OFFICE.created_at);

  const owner = sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(LEGACY_USER.id) as any;
  assert.ok(owner, "legacy owner user row missing after migration");
  assert.equal(owner.email, LEGACY_USER.email);
  assert.equal(owner.login_id, LEGACY_USER.login_id);
  assert.equal(owner.password, LEGACY_USER.password);
  assert.equal(owner.role, LEGACY_USER.role);

  const staff = sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(LEGACY_STAFF.id) as any;
  assert.ok(staff, "legacy staff user row missing after migration");
  assert.equal(staff.role, LEGACY_STAFF.role);

  const job = sqlite.prepare(`SELECT * FROM jobs WHERE id = ?`).get(LEGACY_JOB.id) as any;
  assert.ok(job, "legacy job row missing after migration");
  assert.equal(job.order_id, LEGACY_JOB.order_id);
  assert.equal(job.patient_first_name, LEGACY_JOB.patient_first_name);
  assert.equal(job.patient_last_name, LEGACY_JOB.patient_last_name);
  assert.equal(job.tray_number, LEGACY_JOB.tray_number);
  assert.equal(job.status, LEGACY_JOB.status);
  assert.equal(job.notes, LEGACY_JOB.notes);
  // New nullable columns default to NULL for pre-existing rows.
  assert.equal(job.snoozed_until, null);
  assert.equal(job.snooze_reason, null);

  const flag = sqlite.prepare(`SELECT * FROM job_flags WHERE id = ?`).get(LEGACY_JOB_FLAG.id) as any;
  assert.ok(flag, "legacy job_flags row missing after migration");
  assert.equal(flag.important_note, LEGACY_JOB_FLAG.important_note);

  const history = sqlite
    .prepare(`SELECT * FROM job_status_history WHERE id = ?`)
    .get(LEGACY_STATUS_HISTORY.id) as any;
  assert.ok(history, "legacy job_status_history row missing after migration");
  assert.equal(history.old_status, LEGACY_STATUS_HISTORY.old_status);
  assert.equal(history.new_status, LEGACY_STATUS_HISTORY.new_status);

  const comment = sqlite.prepare(`SELECT * FROM job_comments WHERE id = ?`).get(LEGACY_COMMENT.id) as any;
  assert.ok(comment, "legacy job_comments row missing after migration");
  assert.equal(comment.content, LEGACY_COMMENT.content);
});

test("job_events table and jobs snooze columns exist after migrating the legacy db", () => {
  const jobEventsCols = columnNames("job_events");
  for (const col of [
    "id",
    "job_order_id",
    "job_id",
    "office_id",
    "event_type",
    "actor_user_id",
    "actor_initials",
    "payload",
    "created_at",
  ]) {
    assert.ok(jobEventsCols.includes(col), `job_events missing column ${col} after migration`);
  }

  const jobCols = columnNames("jobs");
  assert.ok(jobCols.includes("snoozed_until"), "jobs missing snoozed_until after migration");
  assert.ok(jobCols.includes("snooze_reason"), "jobs missing snooze_reason after migration");
});

test("fresh job insert + job_events insert round-trip after migration", async () => {
  const newJob = await db
    .insert(schema.jobs)
    .values({
      id: "post-migration-job-1",
      orderId: "ORD-POSTMIGRATION-0001",
      patientFirstName: "New",
      patientLastName: "Patient",
      jobType: "contacts",
      status: "job_created",
      orderDestination: "vision_lab",
      officeId: LEGACY_OFFICE.id,
      createdBy: LEGACY_USER.id,
      snoozedUntil: new Date(NOW + 3600_000),
      snoozeReason: "Waiting on insurance callback",
    })
    .returning();
  assert.equal(newJob.length, 1);
  assert.ok(newJob[0].snoozedUntil instanceof Date);
  assert.equal(newJob[0].snoozeReason, "Waiting on insurance callback");

  const event = await db
    .insert(schema.jobEvents)
    .values({
      id: "post-migration-event-1",
      jobOrderId: "ORD-POSTMIGRATION-0001",
      jobId: "post-migration-job-1",
      officeId: LEGACY_OFFICE.id,
      eventType: "snoozed",
      actorUserId: LEGACY_USER.id,
      actorInitials: "LO",
      payload: { reason: "Waiting on insurance callback" },
    })
    .returning();
  assert.equal(event.length, 1);

  const row = sqlite.prepare(`SELECT * FROM job_events WHERE id = ?`).get("post-migration-event-1") as any;
  assert.ok(row, "post-migration job_events row was not persisted");
  assert.equal(row.job_order_id, "ORD-POSTMIGRATION-0001");
  assert.equal(row.event_type, "snoozed");
});
