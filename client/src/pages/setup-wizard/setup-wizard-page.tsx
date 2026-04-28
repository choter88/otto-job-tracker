import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  X,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_STATUS_COLORS,
  DEFAULT_JOB_TYPE_COLORS,
  DEFAULT_DESTINATION_COLORS,
  hexToHSL,
  normalizeToHex,
} from "@/lib/default-colors";
import { type CustomListItem } from "@/components/customization/sortable-list-editor";
import { type CustomColumn, cleanColumnsForSave } from "@/components/customization/custom-columns-editor";
import { type JobIdentifierMode } from "@/components/customization/identifier-mode-editor";
import { WIZARD_STEPS, getStepIndex } from "./wizard-types";
import StepWelcome from "./steps/step-welcome";
import StepIdentifierMode from "./steps/step-identifier-mode";
import StepStatuses from "./steps/step-statuses";
import StepJobTypes from "./steps/step-job-types";
import StepDestinations from "./steps/step-destinations";
import StepCustomColumns from "./steps/step-custom-columns";
import StepNotificationRules from "./steps/step-notification-rules";
import StepEhrImport from "./steps/step-ehr-import";
import StepDone from "./steps/step-done";
import type { OnboardingStepId } from "@shared/onboarding";

function defaultStatuses(): CustomListItem[] {
  return DEFAULT_STATUS_COLORS.map((d) => ({
    id: d.id,
    label: d.label,
    color: d.hex,
    hsl: d.hsl,
    order: d.order,
  }));
}
function defaultJobTypes(): CustomListItem[] {
  return DEFAULT_JOB_TYPE_COLORS.map((d) => ({
    id: d.id,
    label: d.label,
    color: d.hex,
    hsl: d.hsl,
    order: d.order,
  }));
}
function defaultDestinations(): CustomListItem[] {
  return DEFAULT_DESTINATION_COLORS.map((d) => ({
    id: d.id,
    label: d.label,
    color: d.hex,
    hsl: d.hsl,
    order: d.order,
  }));
}

function normalizeListItems(items: any[]): CustomListItem[] {
  return items.map((item) => ({
    id: String(item.id || ""),
    label: String(item.label || ""),
    color: normalizeToHex(item.color, item.hsl, item.hex),
    hsl: item.hsl || (item.color && /^#/.test(item.color) ? hexToHSL(item.color) : item.hsl || ""),
    order: typeof item.order === "number" ? item.order : 999,
  }));
}

export default function SetupWizardPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    office,
    isLoading: officeLoading,
    onboarding,
    markStepCompleted,
    markWizardCompleted,
    markWizardSkipped,
    isPending: onboardingSaving,
  } = useOnboarding();

  // Step index — initialize from server's completedSteps so resume works.
  const [stepIndex, setStepIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // Editable wizard draft state — initialized from current office settings.
  const [statuses, setStatuses] = useState<CustomListItem[]>(defaultStatuses);
  const [jobTypes, setJobTypes] = useState<CustomListItem[]>(defaultJobTypes);
  const [destinations, setDestinations] = useState<CustomListItem[]>(defaultDestinations);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [identifierMode, setIdentifierMode] = useState<JobIdentifierMode>("patientName");

  // Initialize draft state once when office loads
  useEffect(() => {
    if (!office?.settings || initialized) return;
    const settings = office.settings as any;
    const existingStatuses = Array.isArray(settings.customStatuses) ? settings.customStatuses : [];
    const existingTypes = Array.isArray(settings.customJobTypes) ? settings.customJobTypes : [];
    const existingDestinations = Array.isArray(settings.customOrderDestinations)
      ? settings.customOrderDestinations
      : [];
    const existingColumns = Array.isArray(settings.customColumns) ? settings.customColumns : [];

    setStatuses(existingStatuses.length > 0 ? normalizeListItems(existingStatuses) : defaultStatuses());
    setJobTypes(existingTypes.length > 0 ? normalizeListItems(existingTypes) : defaultJobTypes());
    setDestinations(
      existingDestinations.length > 0 ? normalizeListItems(existingDestinations) : defaultDestinations(),
    );
    setColumns(existingColumns as CustomColumn[]);
    setIdentifierMode(settings.jobIdentifierMode === "trayNumber" ? "trayNumber" : "patientName");

    // Step entry rule:
    // - Fresh office (state: pending) → always start at Welcome (step 0). The
    //   user has never seen the wizard; they get the intro.
    // - Resuming (state: in_progress / skipped) → jump to the first step they
    //   haven't completed yet so they don't have to click through.
    // - Re-run (state: completed but reset) → also pending; same as fresh.
    if (onboarding.state === "pending") {
      setStepIndex(0);
    } else {
      const idx = WIZARD_STEPS.findIndex(
        (s) => s.id !== "done" && !onboarding.completedSteps.includes(s.id),
      );
      setStepIndex(idx >= 0 ? idx : 0);
    }
    setInitialized(true);
  }, [office, initialized, onboarding.completedSteps, onboarding.state]);

  // Save settings keys for the current step.
  const saveSettingsMutation = useMutation({
    mutationFn: async (partial: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/offices/${user?.officeId}`, { settings: partial });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    },
  });

  const currentStep = WIZARD_STEPS[stepIndex];

  // What gets persisted when "Save & continue" is pressed.
  async function persistCurrentStep(): Promise<boolean> {
    switch (currentStep.id) {
      case "welcome":
        return true;
      case "identifier_mode":
        await saveSettingsMutation.mutateAsync({ jobIdentifierMode: identifierMode });
        return true;
      case "statuses":
        await saveSettingsMutation.mutateAsync({ customStatuses: statuses });
        return true;
      case "job_types":
        await saveSettingsMutation.mutateAsync({ customJobTypes: jobTypes });
        return true;
      case "destinations":
        await saveSettingsMutation.mutateAsync({ customOrderDestinations: destinations });
        return true;
      case "custom_columns": {
        const { cleaned, invalidColumn } = cleanColumnsForSave(columns);
        if (invalidColumn) {
          toast({
            title: "Missing options",
            description: `Select column "${invalidColumn.name}" needs at least one option.`,
            variant: "destructive",
          });
          return false;
        }
        await saveSettingsMutation.mutateAsync({ customColumns: cleaned });
        return true;
      }
      case "notification_rules":
        // Notification rules write to their own table via NotificationRules component.
        return true;
      case "ehr_import":
        // Import is optional and writes to jobs, not settings.
        return true;
      case "done":
        return true;
    }
    return true;
  }

  async function handleNext() {
    const ok = await persistCurrentStep();
    if (!ok) return;
    try {
      await markStepCompleted(currentStep.id as OnboardingStepId);
    } catch (err: any) {
      toast({
        title: "Couldn't save your progress",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
      return;
    }
    if (stepIndex >= WIZARD_STEPS.length - 1) {
      await markWizardCompleted();
      navigate("/");
      return;
    }
    setStepIndex(stepIndex + 1);
  }

  function handleBack() {
    if (stepIndex === 0) return;
    setStepIndex(stepIndex - 1);
  }

  async function handleSkipStep() {
    if (!currentStep.optional) return;
    try {
      await markStepCompleted(currentStep.id as OnboardingStepId);
    } catch (err: any) {
      toast({
        title: "Couldn't save your progress",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
      return;
    }
    if (stepIndex >= WIZARD_STEPS.length - 1) {
      await markWizardCompleted();
      navigate("/");
      return;
    }
    setStepIndex(stepIndex + 1);
  }

  async function handleSkipWizard() {
    try {
      await markWizardSkipped();
      navigate("/");
    } catch (err: any) {
      toast({
        title: "Couldn't skip",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
    }
  }

  const stepBody = useMemo(() => {
    switch (currentStep.id) {
      case "welcome":
        return <StepWelcome />;
      case "identifier_mode":
        return <StepIdentifierMode value={identifierMode} onChange={setIdentifierMode} />;
      case "statuses":
        return <StepStatuses items={statuses} onChange={setStatuses} />;
      case "job_types":
        return <StepJobTypes items={jobTypes} onChange={setJobTypes} />;
      case "destinations":
        return <StepDestinations items={destinations} onChange={setDestinations} />;
      case "custom_columns":
        return <StepCustomColumns columns={columns} onChange={setColumns} />;
      case "notification_rules":
        return <StepNotificationRules />;
      case "ehr_import":
        return <StepEhrImport />;
      case "done":
        return <StepDone />;
    }
  }, [currentStep.id, identifierMode, statuses, jobTypes, destinations, columns]);

  if (officeLoading || !office) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === WIZARD_STEPS.length - 1;
  const saving = saveSettingsMutation.isPending || onboardingSaving;

  return (
    <div
      className="fixed inset-0 grid place-items-center p-6 overflow-auto"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -100px, var(--otto-accent-soft) 0%, transparent 60%), var(--paper)",
      }}
    >
      {/* Skip-setup escape hatch in the corner */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSkipWizard}
        disabled={saving}
        className="absolute top-4 right-4 text-ink-mute hover:text-ink"
        data-testid="button-skip-wizard"
      >
        <X className="mr-2 h-4 w-4" />
        Skip setup
      </Button>

      <div
        className="w-full max-w-[920px] bg-panel border border-line rounded-[18px] shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-[264px_1fr]"
        data-screen-label={`Setup · ${currentStep.shortTitle}`}
      >
        {/* Aside */}
        <aside className="bg-paper-2 border-r border-line p-6 md:p-7 flex flex-col gap-6 md:gap-7">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-panel grid place-items-center">
              <SettingsIcon className="h-4 w-4 text-otto-accent" />
            </div>
            <div>
              <div className="font-display font-semibold text-[calc(14px*var(--ui-scale))] text-ink">Otto Desktop</div>
              <div className="font-mono text-[calc(11px*var(--ui-scale))] text-ink-mute">first-run setup</div>
            </div>
          </div>

          <ol className="flex flex-col gap-0.5">
            {WIZARD_STEPS.map((step, idx) => {
              const isComplete = idx < stepIndex || onboarding.completedSteps.includes(step.id);
              const isCurrent = idx === stepIndex;
              return (
                <li key={step.id}>
                  <div
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[calc(13px*var(--ui-scale))] ${
                      isCurrent
                        ? "bg-panel font-semibold text-ink shadow-soft"
                        : isComplete
                          ? "text-ink-2"
                          : "text-ink-mute"
                    }`}
                    data-testid={`wizard-nav-${step.id}`}
                  >
                    <span
                      className={`w-[22px] h-[22px] rounded-full grid place-items-center font-mono text-[calc(11px*var(--ui-scale))] font-medium shrink-0 ${
                        isComplete
                          ? "bg-ink-3 text-white"
                          : isCurrent
                            ? "bg-otto-accent text-white"
                            : "bg-panel text-ink-mute ring-1 ring-line-strong"
                      }`}
                    >
                      {isComplete ? <Check className="h-[11px] w-[11px]" /> : idx + 1}
                    </span>
                    <span className="truncate">{step.shortTitle}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-auto text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-relaxed hidden md:block">
            Same Otto, same account, everywhere.
            <br />
            One sign-in for portal, desktop, and tablet.
          </div>
        </aside>

        {/* Main — fixed height so the footer (Save & continue button) stays
             pinned to the same Y position regardless of step content. The body
             above scrolls if a step's content overflows. */}
        <main className="flex flex-col h-[600px]">
          {/* Mobile stepper */}
          <div className="md:hidden flex items-center gap-1.5 px-7 pt-7 text-xs text-ink-mute overflow-x-auto">
            {WIZARD_STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`shrink-0 ${i === stepIndex ? "text-ink font-medium" : ""}`}
              >
                {s.shortTitle}
                {i < WIZARD_STEPS.length - 1 ? <ChevronRight className="inline h-3 w-3 ml-1" /> : null}
              </div>
            ))}
          </div>

          {/* Scrollable body — contents may grow but footer stays put */}
          <div className="flex-1 overflow-y-auto px-7 md:px-9 py-7 md:py-8">
            {stepBody}
          </div>

          <div className="px-7 md:px-9 py-5 flex items-center justify-end gap-2 border-t border-line-2 shrink-0">
            {!isFirst && (
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={saving}
                data-testid="button-wizard-back"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
            <span className="flex-1" />
            {currentStep.optional && (
              <Button
                variant="ghost"
                onClick={handleSkipStep}
                disabled={saving}
                data-testid="button-wizard-skip-step"
              >
                Skip step
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={saving}
              data-testid="button-wizard-next"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isLast ? "Open dashboard" : isFirst ? "Get started" : "Save & continue"}
              {!saving && !isLast && <ArrowRight className="ml-2 h-4 w-4" />}
              {!saving && isLast && <Check className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
