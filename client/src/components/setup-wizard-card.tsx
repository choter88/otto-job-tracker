import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sparkles, RotateCw, ChevronRight } from "lucide-react";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useToast } from "@/hooks/use-toast";

interface SetupWizardCardProps {
  /** Called after navigating, so the parent (settings modal) can close itself. */
  onNavigate?: () => void;
}

/**
 * Shown at the top of the General tab in Office Settings.
 *
 * - When `state !== 'completed'`: prominent "Continue setup" / "Start setup" card.
 * - When `state === 'completed'`: a small "Re-run setup wizard" link.
 *
 * Owner/Manager only — anyone else sees nothing.
 */
export default function SetupWizardCard({ onNavigate }: SetupWizardCardProps) {
  const { onboarding, showSetupCard, resetWizard, isPending } = useOnboarding();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Non-owner/manager: render nothing.
  if (!showSetupCard && onboarding.state !== "completed") return null;

  function go() {
    onNavigate?.();
    navigate("/setup");
  }

  async function rerun() {
    try {
      await resetWizard();
      onNavigate?.();
      navigate("/setup");
    } catch (err: any) {
      toast({
        title: "Couldn't re-launch setup",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
    }
  }

  if (showSetupCard) {
    const isResume = onboarding.state === "in_progress" || onboarding.state === "skipped";
    const completedCount = onboarding.completedSteps.length;
    return (
      <div
        className="rounded-lg border border-primary/40 bg-primary/5 p-4 mb-4"
        data-testid="setup-wizard-card"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 mt-0.5">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">
              {isResume ? "Resume setup" : "Welcome to Otto — finish your initial setup"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isResume
                ? `You completed ${completedCount} step${completedCount === 1 ? "" : "s"}. Pick up where you left off.`
                : "Walk through the few things Otto needs to know about your office. Takes about 5 minutes."}
            </p>
          </div>
          <Button size="sm" onClick={go} data-testid="button-start-setup-wizard">
            {isResume ? "Continue" : "Start"}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Completed — show the small re-run link.
  return (
    <div className="text-xs text-muted-foreground mb-4">
      <button
        type="button"
        onClick={rerun}
        disabled={isPending}
        className="inline-flex items-center hover:text-foreground hover:underline transition-colors"
        data-testid="button-rerun-setup-wizard"
      >
        <RotateCw className="mr-1 h-3 w-3" />
        Re-run setup wizard
      </button>
    </div>
  );
}
