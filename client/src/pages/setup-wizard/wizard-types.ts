import type { OnboardingStepId } from "@shared/onboarding";

export interface WizardStepDefinition {
  id: OnboardingStepId;
  title: string;
  shortTitle: string;
  /** Optional — steps with `optional: true` show a "Skip step" button. */
  optional?: boolean;
}

export const WIZARD_STEPS: WizardStepDefinition[] = [
  { id: "welcome", title: "Welcome to Otto", shortTitle: "Welcome" },
  { id: "identifier_mode", title: "How do you identify jobs?", shortTitle: "Job IDs" },
  { id: "statuses", title: "Job statuses", shortTitle: "Statuses" },
  { id: "job_types", title: "Job types", shortTitle: "Job Types" },
  { id: "destinations", title: "Labs", shortTitle: "Labs" },
  {
    id: "custom_columns",
    title: "Custom fields (optional)",
    shortTitle: "Custom Fields",
    optional: true,
  },
  { id: "notification_rules", title: "Overdue rules", shortTitle: "Overdue Rules" },
  { id: "ehr_import", title: "Import from EHR", shortTitle: "EHR Import", optional: true },
  { id: "done", title: "All set", shortTitle: "Done" },
];

export function getStepIndex(id: OnboardingStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}
