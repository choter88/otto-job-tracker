/**
 * End-to-end style tests of the wizard flow at the storage + helper layer.
 * Exercises the same sequence of mutations the React wizard produces:
 *   - mark step completed
 *   - update an unrelated settings key in between (simulates concurrent edit)
 *   - mark wizard completed at the end
 *
 * The point is to confirm the merge in updateOffice + the helper functions
 * compose without losing wizard state.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-wizard-flow-"));
const TEST_DB_PATH = path.join(TEST_DIR, "wizard-flow.sqlite");

process.env.OTTO_SQLITE_PATH = TEST_DB_PATH;

const { storage } = await import("../server/storage");
const { sqlite } = await import("../server/db");
const {
  getOnboarding,
  markStepCompleted,
  markWizardCompleted,
  markWizardSkipped,
  resetWizardState,
  shouldAutoLaunchWizard,
  shouldShowSetupCard,
} = await import("../shared/onboarding");

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

test("happy path: pending → in_progress (step done) → completed; auto-launch flips off", async () => {
  const office = await storage.createOffice({ name: "Happy Path" });
  let onboarding = getOnboarding(office.settings);
  assert.equal(onboarding.state, "pending");
  assert.equal(shouldAutoLaunchWizard(office.settings, "owner"), true);
  assert.equal(shouldShowSetupCard(office.settings, "owner"), true);

  // Step 1 done
  onboarding = markStepCompleted(onboarding, "statuses");
  await storage.updateOffice(office.id, { settings: { onboarding } } as any);

  let fresh = await storage.getOffice(office.id);
  assert.ok(fresh);
  let updated = getOnboarding(fresh!.settings);
  assert.equal(updated.state, "in_progress");
  assert.deepEqual(updated.completedSteps, ["statuses"]);
  // Once in_progress, auto-launch is false (only fires on `pending`).
  assert.equal(shouldAutoLaunchWizard(fresh!.settings, "owner"), false);
  // Setup card stays visible until completed.
  assert.equal(shouldShowSetupCard(fresh!.settings, "owner"), true);

  // Wizard finished
  onboarding = markWizardCompleted(updated);
  await storage.updateOffice(office.id, { settings: { onboarding } } as any);

  fresh = await storage.getOffice(office.id);
  updated = getOnboarding(fresh!.settings);
  assert.equal(updated.state, "completed");
  assert.equal(shouldAutoLaunchWizard(fresh!.settings, "owner"), false);
  assert.equal(shouldShowSetupCard(fresh!.settings, "owner"), false);
});

test("interleaved settings edit between steps does NOT clobber wizard state", async () => {
  const office = await storage.createOffice({ name: "Interleaved" });

  // Step done
  let onboarding = markStepCompleted(getOnboarding(office.settings), "statuses");
  await storage.updateOffice(office.id, { settings: { onboarding } } as any);

  // Concurrent settings save (e.g. another user changes the identifier mode).
  await storage.updateOffice(office.id, {
    settings: { jobIdentifierMode: "trayNumber" },
  } as any);

  const fresh = await storage.getOffice(office.id);
  const updated = getOnboarding(fresh!.settings);
  assert.equal(updated.state, "in_progress");
  assert.deepEqual(updated.completedSteps, ["statuses"]);
  assert.equal((fresh!.settings as any).jobIdentifierMode, "trayNumber");
});

test("skip wizard: state=skipped, auto-launch off, setup card still visible to Owner", async () => {
  const office = await storage.createOffice({ name: "Skipped" });
  const onboarding = markWizardSkipped(getOnboarding(office.settings));
  await storage.updateOffice(office.id, { settings: { onboarding } } as any);

  const fresh = await storage.getOffice(office.id);
  const updated = getOnboarding(fresh!.settings);
  assert.equal(updated.state, "skipped");
  assert.equal(shouldAutoLaunchWizard(fresh!.settings, "owner"), false);
  // Card stays visible so the Owner can resume.
  assert.equal(shouldShowSetupCard(fresh!.settings, "owner"), true);
});

test("re-run wizard from completed state: state resets to pending, settings keep current values", async () => {
  const office = await storage.createOffice({ name: "Rerun" });

  // First: customize statuses and complete the wizard.
  await storage.updateOffice(office.id, {
    settings: { customStatuses: [{ id: "job_created", label: "JC", color: "#0F0", order: 1 }] },
  } as any);
  await storage.updateOffice(office.id, {
    settings: { onboarding: markWizardCompleted(getOnboarding(office.settings)) },
  } as any);

  let fresh = await storage.getOffice(office.id);
  assert.equal(getOnboarding(fresh!.settings).state, "completed");

  // Click "Re-run setup wizard" — resets state to pending. Settings keep current values.
  await storage.updateOffice(office.id, { settings: { onboarding: resetWizardState() } } as any);

  fresh = await storage.getOffice(office.id);
  const updated = getOnboarding(fresh!.settings);
  assert.equal(updated.state, "pending");
  assert.deepEqual(updated.completedSteps, []);
  // The customStatuses change must NOT be wiped by re-running the wizard.
  assert.ok(Array.isArray((fresh!.settings as any).customStatuses));
  assert.equal((fresh!.settings as any).customStatuses[0].id, "job_created");
});

test("non-Owner user never auto-launches even on a pending office", async () => {
  const office = await storage.createOffice({ name: "Pending" });
  // Pending state from createOffice
  for (const role of ["staff", "view_only", "super_admin", null, undefined]) {
    assert.equal(
      shouldAutoLaunchWizard(office.settings, role as any),
      false,
      `role=${role} should not auto-launch`,
    );
  }
});

test("undefined onboarding (existing user upgrade scenario) → no auto-launch ever", async () => {
  // Simulate an office that pre-dates this feature: the onboarding key is
  // missing from settings entirely.
  const office = await storage.createOffice({ name: "Pre-existing" });

  // Wipe the onboarding key by overwriting with a settings object that lacks it.
  // We do this with a raw SQL update so we bypass the seeded-default protection.
  sqlite
    .prepare("UPDATE offices SET settings = ? WHERE id = ?")
    .run(JSON.stringify({ customStatuses: [] }), office.id);

  const fresh = await storage.getOffice(office.id);
  const settings = fresh!.settings as any;
  assert.equal(settings.onboarding, undefined);

  // Helpers must default to "completed" semantics.
  assert.equal(shouldAutoLaunchWizard(settings, "owner"), false);
  assert.equal(shouldShowSetupCard(settings, "owner"), false);
  assert.equal(getOnboarding(settings).state, "completed");
});
