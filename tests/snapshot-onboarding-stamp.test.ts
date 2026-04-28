/**
 * Snapshot import must stamp `onboarding: completed/backup` regardless of what
 * (if anything) was in the source snapshot. This guarantees:
 *  1. Pre-existing backups (no onboarding key) → restored offices don't get
 *     the wizard pushed at them.
 *  2. Snapshots from older versions where the user happened to skip the wizard
 *     (state: skipped) → still stamped completed/backup so the banner can
 *     show on the new install.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-snap-stamp-"));
const TEST_DB_PATH = path.join(TEST_DIR, "stamp.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { importSnapshotV1 } = await import("../server/migration-import");
const { sqlite } = await import("../server/db");

const NOW = Date.now();

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DELETE FROM comment_reads;
    DELETE FROM job_comments;
    DELETE FROM job_flags;
    DELETE FROM job_status_history;
    DELETE FROM notification_rules;
    DELETE FROM archived_jobs;
    DELETE FROM jobs;
    DELETE FROM account_signup_requests;
    DELETE FROM users;
    DELETE FROM offices;
  `);
  sqlite.pragma("foreign_keys = ON");
}

function makeSnapshot(officeSettings: Record<string, any>) {
  return {
    format: "otto-snapshot",
    version: 1,
    exportedAt: new Date(NOW).toISOString(),
    office: {
      id: "office-restored-1",
      name: "Restored Office",
      enabled: true,
      settings: officeSettings,
      createdAt: NOW,
      updatedAt: NOW,
    },
    users: [],
    jobs: [],
    archivedJobs: [],
    jobComments: [],
    jobStatusHistory: [],
    notificationRules: [],
  };
}

const ADMIN = {
  loginId: "admin",
  firstName: "Admin",
  lastName: "User",
  passwordHash: "hash.value",
  pinHash: "pinhash",
};

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

function getOfficeSettings(officeId: string): any {
  const row = sqlite
    .prepare("SELECT settings FROM offices WHERE id = ?")
    .get(officeId) as { settings: string };
  return JSON.parse(row.settings);
}

test("snapshot with no onboarding key → stamped completed/backup after import", () => {
  importSnapshotV1({
    snapshot: makeSnapshot({
      customStatuses: [{ id: "job_created", label: "Job Created", color: "#0F0", order: 1 }],
    }),
    admin: ADMIN,
    activationCodeLast4: "1111",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  const settings = getOfficeSettings("office-restored-1");
  assert.ok(settings.onboarding, "onboarding key must be present after restore");
  assert.equal(settings.onboarding.state, "completed");
  assert.equal(settings.onboarding.source, "backup");
});

test("snapshot WITH onboarding state pending is overwritten to completed/backup", () => {
  importSnapshotV1({
    snapshot: makeSnapshot({
      onboarding: {
        state: "pending",
        source: "fresh",
        completedSteps: [],
        version: 1,
      },
    }),
    admin: ADMIN,
    activationCodeLast4: "2222",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  const settings = getOfficeSettings("office-restored-1");
  assert.equal(settings.onboarding.state, "completed");
  assert.equal(settings.onboarding.source, "backup");
});

test("snapshot import preserves other settings keys alongside the new onboarding stamp", () => {
  importSnapshotV1({
    snapshot: makeSnapshot({
      customStatuses: [
        { id: "job_created", label: "Job Created", color: "#0F0", order: 1 },
        { id: "completed", label: "Completed", color: "#00F", order: 2 },
      ],
      jobIdentifierMode: "trayNumber",
      customColumns: [{ id: "col1", name: "Lab", type: "text", order: 1, active: true }],
    }),
    admin: ADMIN,
    activationCodeLast4: "3333",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  const settings = getOfficeSettings("office-restored-1");
  // Onboarding stamp present.
  assert.equal(settings.onboarding.state, "completed");
  assert.equal(settings.onboarding.source, "backup");
  // Other settings preserved.
  assert.equal(settings.jobIdentifierMode, "trayNumber");
  assert.ok(Array.isArray(settings.customStatuses));
  assert.ok(Array.isArray(settings.customColumns));
  assert.equal(settings.customColumns[0].id, "col1");
});
