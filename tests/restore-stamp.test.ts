/**
 * Verifies that the file-copy "Restore Data…" path stamps every restored
 * office with `onboarding.source = 'backup'`. We exercise the same SQL the
 * post-copy stamp in desktop/main.js performs, against a temp DB.
 *
 * Note: we can't load desktop/main.js directly (Electron-only), so this test
 * recreates the stamp logic using better-sqlite3 — the SQL must stay in sync.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-restore-stamp-"));
const TEST_DB_PATH = path.join(TEST_DIR, "restore-test.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`DELETE FROM offices;`);
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

/**
 * Mirror of the post-restore stamp logic in desktop/main.js. Kept here so
 * the test exercises the same shape; if you change one, change both.
 */
function applyRestoreStamp(db: any) {
  const rows = db.prepare("SELECT id, settings FROM offices").all();
  const updateStmt = db.prepare("UPDATE offices SET settings = ? WHERE id = ?");
  for (const row of rows) {
    let parsed: Record<string, any> = {};
    try {
      parsed = typeof row.settings === "string" ? JSON.parse(row.settings || "{}") : (row.settings || {});
    } catch {
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
    const now = new Date().toISOString();
    parsed.onboarding = {
      state: "completed",
      source: "backup",
      completedSteps: [
        "welcome", "identifier_mode", "statuses", "job_types",
        "destinations", "custom_columns", "notification_rules", "ehr_import", "done",
      ],
      skippedAt: null,
      completedAt: now,
      startedAt: now,
      version: 1,
    };
    updateStmt.run(JSON.stringify(parsed), row.id);
  }
}

test("restore stamp turns source=fresh into source=backup", async () => {
  const office = await storage.createOffice({ name: "Real Office Backup" });
  // Pre-condition: createOffice seeds source=fresh.
  let settings = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(settings.onboarding.source, "fresh");
  assert.equal(settings.onboarding.state, "pending");

  applyRestoreStamp(sqlite);

  settings = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(settings.onboarding.source, "backup");
  assert.equal(settings.onboarding.state, "completed");
});

test("restore stamp on missing onboarding key produces a complete onboarding block", async () => {
  // Simulate an old backup where onboarding doesn't exist yet.
  const office = await storage.createOffice({ name: "Pre-onboarding Office" });
  sqlite
    .prepare("UPDATE offices SET settings = ? WHERE id = ?")
    .run(JSON.stringify({ customStatuses: [] }), office.id);

  let settings = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(settings.onboarding, undefined);

  applyRestoreStamp(sqlite);

  settings = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(settings.onboarding.source, "backup");
  assert.equal(settings.onboarding.state, "completed");
  assert.deepEqual(settings.onboarding.completedSteps.length, 9);
});

test("restore stamp preserves other settings keys", async () => {
  const office = await storage.createOffice({ name: "Mixed Office" });
  await storage.updateOffice(office.id, {
    settings: {
      jobIdentifierMode: "trayNumber",
      customColumns: [{ id: "col1", name: "Lab Order", type: "text", order: 1, active: true }],
    },
  } as any);

  applyRestoreStamp(sqlite);

  const settings = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(settings.onboarding.source, "backup");
  // Other keys preserved.
  assert.equal(settings.jobIdentifierMode, "trayNumber");
  assert.equal(settings.customColumns[0].id, "col1");
});

test("restore stamp is idempotent — running twice produces the same source=backup state", async () => {
  const office = await storage.createOffice({ name: "Twice Office" });
  applyRestoreStamp(sqlite);
  const after1 = (await storage.getOffice(office.id))!.settings as any;
  applyRestoreStamp(sqlite);
  const after2 = (await storage.getOffice(office.id))!.settings as any;
  assert.equal(after1.onboarding.source, "backup");
  assert.equal(after2.onboarding.source, "backup");
});
