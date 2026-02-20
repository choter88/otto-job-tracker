import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-migration-import-"));
const TEST_DB_PATH = path.join(TEST_DIR, "migration.sqlite");

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

function baseOffice() {
  return {
    id: "office-1",
    name: "Test Office",
    enabled: true,
    settings: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
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

test("imports legacy placeholder identities and defaults optional arrays", () => {
  const snapshot = {
    format: "otto-snapshot",
    version: 1,
    exportedAt: new Date(NOW).toISOString(),
    office: baseOffice(),
    users: [
      {
        id: "legacy-user-1",
        email: "legacy+staff@otto.local",
        password: "LEGACY_IDENTITY_NO_LOGIN",
        firstName: "",
        lastName: "",
        role: "view_only",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    jobs: [
      {
        id: "job-1",
        orderId: "ORDER-1",
        patientFirstName: "J",
        patientLastName: "Doe",
        jobType: "glasses",
        status: "job_created",
        orderDestination: "vision_lab",
        officeId: "office-1",
        createdBy: "legacy-user-1",
        customColumnValues: {},
        isRedoJob: false,
        statusChangedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    archivedJobs: [],
    jobComments: [],
    jobStatusHistory: [],
    notificationRules: [],
  };

  const result = importSnapshotV1({
    snapshot,
    admin: {
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "User",
      passwordHash: "abcd.efgh",
    },
    staffCodeHash: "staff-hash",
    activationCodeLast4: "1234",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  assert.equal(result.importedCounts.commentReads, 0);
  assert.equal(result.importedCounts.jobFlags, 0);
  assert.equal(result.importedCounts.users, 2);
  assert.equal(result.synthesizedLegacyUsers, 0);

  const legacyUser = sqlite
    .prepare("SELECT email, password, first_name, last_name, role FROM users WHERE id = ?")
    .get("legacy-user-1") as any;
  assert.equal(legacyUser.email, "legacy+staff@otto.local");
  assert.equal(legacyUser.password, "LEGACY_IDENTITY_NO_LOGIN");
  assert.equal(legacyUser.first_name, "Legacy");
  assert.equal(legacyUser.last_name, "User");
  assert.equal(legacyUser.role, "view_only");
});

test("synthesizes legacy non-login users for missing references", () => {
  const snapshot = {
    format: "otto-snapshot",
    version: 1,
    exportedAt: new Date(NOW).toISOString(),
    office: baseOffice(),
    users: [],
    jobs: [
      {
        id: "job-1",
        orderId: "ORDER-1",
        patientFirstName: "A",
        patientLastName: "Patient",
        jobType: "contacts",
        status: "job_created",
        orderDestination: "vision_lab",
        officeId: "office-1",
        createdBy: "missing-created-by",
        customColumnValues: {},
        isRedoJob: false,
        statusChangedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    archivedJobs: [],
    jobComments: [
      {
        id: "comment-1",
        jobId: "job-1",
        authorId: "missing-author",
        content: "Imported legacy comment",
        createdAt: NOW,
      },
    ],
    jobStatusHistory: [
      {
        id: "history-1",
        jobId: "job-1",
        oldStatus: "job_created",
        newStatus: "ordered",
        changedBy: "missing-status-user",
        changedAt: NOW,
      },
    ],
    notificationRules: [],
  };

  const result = importSnapshotV1({
    snapshot,
    admin: {
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "User",
      passwordHash: "abcd.efgh",
    },
    staffCodeHash: "staff-hash",
    activationCodeLast4: "1234",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  assert.equal(result.synthesizedLegacyUsers, 3);
  assert.equal(result.importedCounts.users, 4);

  const synthesizedUsers = sqlite
    .prepare(
      "SELECT id, email, password, role FROM users WHERE id IN (?, ?, ?) ORDER BY id",
    )
    .all("missing-author", "missing-created-by", "missing-status-user") as any[];

  assert.equal(synthesizedUsers.length, 3);
  for (const row of synthesizedUsers) {
    assert.ok(String(row.email).startsWith("legacy+"));
    assert.ok(String(row.email).endsWith("@otto.local"));
    assert.equal(row.password, "LEGACY_IDENTITY_NO_LOGIN");
    assert.equal(row.role, "view_only");
  }
});

test("normalizes imported settings for colors and message templates", () => {
  const snapshot = {
    format: "otto-snapshot",
    version: 1,
    exportedAt: new Date(NOW).toISOString(),
    office: {
      ...baseOffice(),
      settings: {
        jobStatuses: [
          { key: "ordered", name: "Ordered", colorHex: "#D97706" },
          { key: "ready_for_pickup", name: "Ready for Pickup", colorHex: "#16A34A" },
        ],
        jobTypes: [{ value: "contacts", title: "Contacts" }],
        jobTypeColors: {
          contacts: "#1D4ED8",
        },
        orderDestinations: [{ name: "Vision Lab", color: { hex: "#0284C7" } }],
        messageTemplates: {
          ReadyForPickup: "Your order #{order_id} is ready for pickup.",
        },
      },
    },
    users: [
      {
        id: "owner-1",
        email: "owner@demo.com",
        password: "abcd.efgh",
        firstName: "Owner",
        lastName: "Demo",
        role: "owner",
        officeId: "office-1",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    jobs: [
      {
        id: "job-1",
        orderId: "ORDER-1",
        patientFirstName: "A",
        patientLastName: "Patient",
        jobType: "contacts",
        status: "ready_for_pickup",
        orderDestination: "Vision Lab",
        officeId: "office-1",
        createdBy: "owner-1",
        customColumnValues: {},
        isRedoJob: false,
        statusChangedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    archivedJobs: [],
    jobComments: [],
    commentReads: [],
    jobFlags: [],
    jobStatusHistory: [],
    notificationRules: [],
  };

  importSnapshotV1({
    snapshot,
    admin: {
      email: "owner@demo.com",
      firstName: "Owner",
      lastName: "Demo",
      passwordHash: "abcd.efgh",
    },
    staffCodeHash: "staff-hash",
    activationCodeLast4: "1234",
    activationVerifiedAt: NOW,
    now: NOW,
  });

  const officeRow = sqlite.prepare("SELECT settings FROM offices WHERE id = ?").get("office-1") as any;
  assert.ok(officeRow?.settings);
  const settings = JSON.parse(String(officeRow.settings || "{}"));

  assert.ok(Array.isArray(settings.customStatuses));
  assert.ok(Array.isArray(settings.customJobTypes));
  assert.ok(Array.isArray(settings.customOrderDestinations));

  const readyStatus = settings.customStatuses.find((s: any) => s.id === "ready_for_pickup");
  assert.ok(readyStatus);
  assert.equal(readyStatus.color, "#16A34A");

  const contactsType = settings.customJobTypes.find((t: any) => t.id === "contacts");
  assert.ok(contactsType);
  assert.equal(contactsType.color, "#1D4ED8");

  const visionDestination = settings.customOrderDestinations.find((d: any) => d.label === "Vision Lab");
  assert.ok(visionDestination);
  assert.equal(visionDestination.color, "#0284C7");

  assert.ok(settings.smsTemplates);
  assert.equal(
    settings.smsTemplates.ready_for_pickup,
    "Your order #{order_id} is ready for pickup.",
  );
});
