/**
 * Tests for the server-side settings merge in updateOffice.
 *
 * The bug class this prevents: a client sends a partial `settings` object
 * (e.g. just `{ jobIdentifierMode: "trayNumber" }`); without merging, the
 * server would overwrite the entire JSON column, dropping unknown keys
 * including the `onboarding` block. The wizard depends on this merge
 * behavior to track its own state independently of settings edits.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-settings-merge-"));
const TEST_DB_PATH = path.join(TEST_DIR, "settings-merge.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");

function resetDb() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
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

test("createOffice seeds the onboarding block with state=pending, source=fresh", async () => {
  const office = await storage.createOffice({ name: "Test Office" });
  const settings = office.settings as any;
  assert.ok(settings.onboarding, "onboarding key should be set on creation");
  assert.equal(settings.onboarding.state, "pending");
  assert.equal(settings.onboarding.source, "fresh");
});

test("updateOffice merges settings — partial update preserves onboarding key", async () => {
  const office = await storage.createOffice({ name: "Merge Office" });
  const originalOnboarding = (office.settings as any).onboarding;
  assert.ok(originalOnboarding);

  // Send a partial settings update that does NOT include onboarding —
  // simulating a client that doesn't know about the onboarding key.
  const updated = await storage.updateOffice(office.id, {
    settings: { jobIdentifierMode: "trayNumber" },
  } as any);

  const settings = updated.settings as any;
  assert.equal(settings.jobIdentifierMode, "trayNumber");
  assert.ok(settings.onboarding, "onboarding key must survive partial save");
  assert.equal(settings.onboarding.state, "pending");
  assert.equal(settings.onboarding.source, "fresh");
});

test("updateOffice merge: explicit onboarding update applies, other keys preserved", async () => {
  const office = await storage.createOffice({ name: "Onboarding Office" });

  // Owner runs the wizard and marks one step complete.
  await storage.updateOffice(office.id, {
    settings: {
      onboarding: {
        state: "in_progress",
        source: "fresh",
        completedSteps: ["statuses"],
        skippedAt: null,
        completedAt: null,
        startedAt: new Date().toISOString(),
        version: 1,
      },
    },
  } as any);

  // Then in a separate save, the user changes the identifier mode (no
  // onboarding key in the payload).
  const updated = await storage.updateOffice(office.id, {
    settings: { jobIdentifierMode: "trayNumber" },
  } as any);

  const settings = updated.settings as any;
  assert.equal(settings.jobIdentifierMode, "trayNumber");
  // Wizard progress must NOT be clobbered by the unrelated save.
  assert.equal(settings.onboarding.state, "in_progress");
  assert.deepEqual(settings.onboarding.completedSteps, ["statuses"]);
});

test("updateOffice merge: multiple sequential partial updates accumulate", async () => {
  const office = await storage.createOffice({ name: "Sequential Office" });

  await storage.updateOffice(office.id, {
    settings: { customStatuses: [{ id: "a", label: "A", color: "#000", order: 1 }] },
  } as any);
  await storage.updateOffice(office.id, {
    settings: { customJobTypes: [{ id: "t", label: "T", color: "#fff", order: 1 }] },
  } as any);
  const final = await storage.updateOffice(office.id, {
    settings: { jobIdentifierMode: "patientName" },
  } as any);

  const settings = final.settings as any;
  assert.ok(Array.isArray(settings.customStatuses));
  assert.equal(settings.customStatuses[0].id, "a");
  assert.ok(Array.isArray(settings.customJobTypes));
  assert.equal(settings.customJobTypes[0].id, "t");
  assert.equal(settings.jobIdentifierMode, "patientName");
  assert.ok(settings.onboarding);
});

test("updateOffice merge: non-settings fields go through unchanged", async () => {
  const office = await storage.createOffice({ name: "Name Office" });
  const updated = await storage.updateOffice(office.id, { name: "Renamed Office" });
  assert.equal(updated.name, "Renamed Office");
  // Settings unchanged.
  const settings = updated.settings as any;
  assert.ok(settings.onboarding);
});
