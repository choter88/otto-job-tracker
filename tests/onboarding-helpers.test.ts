import test from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_STEP_ORDER,
  ONBOARDING_VERSION,
  defaultOnboardingForBackupRestore,
  defaultOnboardingForExistingOffice,
  defaultOnboardingForNewOffice,
  getOnboarding,
  markStepCompleted,
  markWizardCompleted,
  markWizardSkipped,
  resetWizardState,
  shouldAutoLaunchWizard,
  shouldShowBackupRestoreBanner,
  shouldShowSetupCard,
} from "../shared/onboarding";

const NOW = 1700000000000;

test("defaultOnboardingForNewOffice produces a pending/fresh state", () => {
  const state = defaultOnboardingForNewOffice(NOW);
  assert.equal(state.state, "pending");
  assert.equal(state.source, "fresh");
  assert.deepEqual(state.completedSteps, []);
  assert.equal(state.skippedAt, null);
  assert.equal(state.completedAt, null);
  assert.equal(state.version, ONBOARDING_VERSION);
});

test("defaultOnboardingForBackupRestore produces a completed/backup state", () => {
  const state = defaultOnboardingForBackupRestore(NOW);
  assert.equal(state.state, "completed");
  assert.equal(state.source, "backup");
  assert.deepEqual(state.completedSteps, ONBOARDING_STEP_ORDER);
  assert.ok(state.completedAt);
});

test("defaultOnboardingForExistingOffice produces completed/fresh — never auto-launches", () => {
  const state = defaultOnboardingForExistingOffice(NOW);
  assert.equal(state.state, "completed");
  assert.equal(state.source, "fresh");
});

test("getOnboarding: undefined settings → completed (existing office default)", () => {
  assert.equal(getOnboarding(undefined).state, "completed");
  assert.equal(getOnboarding(null).state, "completed");
  assert.equal(getOnboarding({}).state, "completed");
  assert.equal(getOnboarding({ unrelated: 1 }).state, "completed");
});

test("getOnboarding: malformed onboarding key falls back to completed", () => {
  assert.equal(getOnboarding({ onboarding: "not an object" }).state, "completed");
  assert.equal(getOnboarding({ onboarding: [] }).state, "completed");
  assert.equal(getOnboarding({ onboarding: null }).state, "completed");
});

test("getOnboarding: invalid `state` value falls back to completed", () => {
  assert.equal(
    getOnboarding({ onboarding: { state: "bogus" } }).state,
    "completed",
  );
});

test("getOnboarding: tolerates partial data and filters bogus completedSteps", () => {
  const state = getOnboarding({
    onboarding: {
      state: "in_progress",
      source: "fresh",
      completedSteps: ["welcome", "bogus_step", "statuses"],
    },
  });
  assert.equal(state.state, "in_progress");
  assert.deepEqual(state.completedSteps, ["welcome", "statuses"]);
});

test("getOnboarding: preserves backup source", () => {
  const state = getOnboarding({
    onboarding: { state: "completed", source: "backup", completedSteps: [] },
  });
  assert.equal(state.source, "backup");
});

test("shouldAutoLaunchWizard: true for owner on pending/fresh", () => {
  const settings = { onboarding: defaultOnboardingForNewOffice() };
  assert.equal(shouldAutoLaunchWizard(settings, "owner"), true);
  assert.equal(shouldAutoLaunchWizard(settings, "manager"), true);
});

test("shouldAutoLaunchWizard: false for non-owner/manager", () => {
  const settings = { onboarding: defaultOnboardingForNewOffice() };
  assert.equal(shouldAutoLaunchWizard(settings, "staff"), false);
  assert.equal(shouldAutoLaunchWizard(settings, "view_only"), false);
  // super_admin must NOT auto-launch (they bypass role checks elsewhere but
  // shouldn't be funneled through the wizard).
  assert.equal(shouldAutoLaunchWizard(settings, "super_admin"), false);
  assert.equal(shouldAutoLaunchWizard(settings, null), false);
  assert.equal(shouldAutoLaunchWizard(settings, undefined), false);
});

test("shouldAutoLaunchWizard: false for backup-restored offices", () => {
  const settings = { onboarding: defaultOnboardingForBackupRestore() };
  assert.equal(shouldAutoLaunchWizard(settings, "owner"), false);
});

test("shouldAutoLaunchWizard: false for skipped wizards", () => {
  const settings = {
    onboarding: { state: "skipped", source: "fresh", completedSteps: [] },
  };
  assert.equal(shouldAutoLaunchWizard(settings, "owner"), false);
});

test("shouldAutoLaunchWizard: false for pre-existing offices (undefined onboarding)", () => {
  assert.equal(shouldAutoLaunchWizard({}, "owner"), false);
  assert.equal(shouldAutoLaunchWizard(undefined, "owner"), false);
});

test("shouldShowSetupCard: only Owner/Manager, only when not completed", () => {
  const pending = { onboarding: defaultOnboardingForNewOffice() };
  const completed = { onboarding: defaultOnboardingForExistingOffice() };
  const skipped = {
    onboarding: { state: "skipped", source: "fresh", completedSteps: [] },
  };
  assert.equal(shouldShowSetupCard(pending, "owner"), true);
  assert.equal(shouldShowSetupCard(skipped, "owner"), true);
  assert.equal(shouldShowSetupCard(completed, "owner"), false);
  assert.equal(shouldShowSetupCard(pending, "staff"), false);
  assert.equal(shouldShowSetupCard(pending, "super_admin"), false);
});

test("shouldShowBackupRestoreBanner: only Owner/Manager, only for backup source", () => {
  const backup = { onboarding: defaultOnboardingForBackupRestore() };
  const fresh = { onboarding: defaultOnboardingForNewOffice() };
  assert.equal(shouldShowBackupRestoreBanner(backup, "owner"), true);
  assert.equal(shouldShowBackupRestoreBanner(backup, "manager"), true);
  assert.equal(shouldShowBackupRestoreBanner(fresh, "owner"), false);
  assert.equal(shouldShowBackupRestoreBanner(backup, "staff"), false);
});

test("markStepCompleted: appends to completedSteps and bumps state to in_progress", () => {
  const state = defaultOnboardingForNewOffice(NOW);
  const next = markStepCompleted(state, "statuses", NOW + 1000);
  assert.deepEqual(next.completedSteps, ["statuses"]);
  assert.equal(next.state, "in_progress");

  // Idempotent
  const sameAgain = markStepCompleted(next, "statuses");
  assert.deepEqual(sameAgain.completedSteps, ["statuses"]);
});

test("markStepCompleted: does not regress in_progress→pending", () => {
  const state = { state: "in_progress" as const, source: "fresh" as const, completedSteps: [], skippedAt: null, completedAt: null, startedAt: null, version: 1 };
  const next = markStepCompleted(state, "statuses");
  assert.equal(next.state, "in_progress");
});

test("markWizardCompleted: completedSteps = full list, state = completed", () => {
  const next = markWizardCompleted(defaultOnboardingForNewOffice(), NOW);
  assert.equal(next.state, "completed");
  assert.deepEqual(next.completedSteps, ONBOARDING_STEP_ORDER);
  assert.ok(next.completedAt);
});

test("markWizardSkipped: state = skipped, completedSteps preserved", () => {
  const partial = markStepCompleted(defaultOnboardingForNewOffice(), "statuses");
  const next = markWizardSkipped(partial, NOW);
  assert.equal(next.state, "skipped");
  assert.deepEqual(next.completedSteps, ["statuses"]);
  assert.ok(next.skippedAt);
});

test("resetWizardState: produces fresh pending — caller's settings not touched here", () => {
  const reset = resetWizardState(NOW);
  assert.equal(reset.state, "pending");
  assert.equal(reset.source, "fresh");
  assert.deepEqual(reset.completedSteps, []);
});
