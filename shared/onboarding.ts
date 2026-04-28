/**
 * Onboarding state lives in office.settings.onboarding.
 *
 * Pre-existing offices that upgrade to this version will have an undefined
 * onboarding key. We treat that as "completed" so they don't get pushed
 * through the wizard on upgrade.
 */

export type OnboardingStateName = "pending" | "in_progress" | "completed" | "skipped";

export type OnboardingSource = "fresh" | "backup";

export type OnboardingStepId =
  | "welcome"
  | "identifier_mode"
  | "statuses"
  | "job_types"
  | "destinations"
  | "custom_columns"
  | "notification_rules"
  | "ehr_import"
  | "done";

export interface OnboardingState {
  state: OnboardingStateName;
  source: OnboardingSource;
  completedSteps: OnboardingStepId[];
  skippedAt: string | null;
  completedAt: string | null;
  startedAt: string | null;
  version: number;
}

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "identifier_mode",
  "statuses",
  "job_types",
  "destinations",
  "custom_columns",
  "notification_rules",
  "ehr_import",
  "done",
];

export function defaultOnboardingForNewOffice(now: number = Date.now()): OnboardingState {
  return {
    state: "pending",
    source: "fresh",
    completedSteps: [],
    skippedAt: null,
    completedAt: null,
    startedAt: new Date(now).toISOString(),
    version: ONBOARDING_VERSION,
  };
}

export function defaultOnboardingForBackupRestore(now: number = Date.now()): OnboardingState {
  const ts = new Date(now).toISOString();
  return {
    state: "completed",
    source: "backup",
    completedSteps: [...ONBOARDING_STEP_ORDER],
    skippedAt: null,
    completedAt: ts,
    startedAt: ts,
    version: ONBOARDING_VERSION,
  };
}

/**
 * For existing offices that pre-date this feature: undefined onboarding is
 * treated as "completed". Without this, every existing user would get the
 * wizard pushed at them on upgrade.
 */
export function defaultOnboardingForExistingOffice(now: number = Date.now()): OnboardingState {
  const ts = new Date(now).toISOString();
  return {
    state: "completed",
    source: "fresh",
    completedSteps: [...ONBOARDING_STEP_ORDER],
    skippedAt: null,
    completedAt: ts,
    startedAt: ts,
    version: ONBOARDING_VERSION,
  };
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the onboarding block from arbitrary settings JSON. Tolerates partial
 * or malformed data and defaults missing fields to "completed/fresh" so
 * pre-existing offices are never pushed through the wizard on upgrade.
 */
export function getOnboarding(settings: unknown, now: number = Date.now()): OnboardingState {
  if (!isPlainObject(settings)) return defaultOnboardingForExistingOffice(now);
  const raw = settings.onboarding;
  if (!isPlainObject(raw)) return defaultOnboardingForExistingOffice(now);

  const stateRaw = String(raw.state || "");
  const validStates: OnboardingStateName[] = ["pending", "in_progress", "completed", "skipped"];
  const state: OnboardingStateName = validStates.includes(stateRaw as OnboardingStateName)
    ? (stateRaw as OnboardingStateName)
    : "completed";

  const sourceRaw = String(raw.source || "");
  const source: OnboardingSource = sourceRaw === "backup" ? "backup" : "fresh";

  const completedStepsRaw = Array.isArray(raw.completedSteps) ? raw.completedSteps : [];
  const completedSteps: OnboardingStepId[] = completedStepsRaw
    .map((s: unknown) => String(s))
    .filter((s: string): s is OnboardingStepId => ONBOARDING_STEP_ORDER.includes(s as OnboardingStepId));

  return {
    state,
    source,
    completedSteps,
    skippedAt: typeof raw.skippedAt === "string" ? raw.skippedAt : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    version: typeof raw.version === "number" ? raw.version : ONBOARDING_VERSION,
  };
}

/** Should the wizard auto-launch for the given user? */
export function shouldAutoLaunchWizard(
  settings: unknown,
  userRole: string | null | undefined,
): boolean {
  if (userRole !== "owner" && userRole !== "manager") return false;
  const onboarding = getOnboarding(settings);
  return onboarding.state === "pending" && onboarding.source === "fresh";
}

/** Should the SetupWizardCard appear in the General tab for the given user? */
export function shouldShowSetupCard(
  settings: unknown,
  userRole: string | null | undefined,
): boolean {
  if (userRole !== "owner" && userRole !== "manager") return false;
  const onboarding = getOnboarding(settings);
  return onboarding.state !== "completed";
}

/** Should the "restored from backup" banner show? (Owner/Manager only.) */
export function shouldShowBackupRestoreBanner(
  settings: unknown,
  userRole: string | null | undefined,
): boolean {
  if (userRole !== "owner" && userRole !== "manager") return false;
  const onboarding = getOnboarding(settings);
  return onboarding.source === "backup";
}

export function markStepCompleted(
  current: OnboardingState,
  step: OnboardingStepId,
  now: number = Date.now(),
): OnboardingState {
  const completedSteps = current.completedSteps.includes(step)
    ? current.completedSteps
    : [...current.completedSteps, step];
  return {
    ...current,
    state: current.state === "pending" ? "in_progress" : current.state,
    completedSteps,
    startedAt: current.startedAt || new Date(now).toISOString(),
  };
}

export function markWizardCompleted(
  current: OnboardingState,
  now: number = Date.now(),
): OnboardingState {
  const ts = new Date(now).toISOString();
  return {
    ...current,
    state: "completed",
    completedAt: ts,
    completedSteps: [...ONBOARDING_STEP_ORDER],
  };
}

export function markWizardSkipped(
  current: OnboardingState,
  now: number = Date.now(),
): OnboardingState {
  return {
    ...current,
    state: "skipped",
    skippedAt: new Date(now).toISOString(),
  };
}

export function resetWizardState(now: number = Date.now()): OnboardingState {
  return {
    state: "pending",
    source: "fresh",
    completedSteps: [],
    skippedAt: null,
    completedAt: null,
    startedAt: new Date(now).toISOString(),
    version: ONBOARDING_VERSION,
  };
}
