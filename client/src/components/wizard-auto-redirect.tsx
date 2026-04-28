import { Redirect, useLocation } from "wouter";
import { useOnboarding } from "@/hooks/use-onboarding";

/**
 * Wrap a page component with this guard. If the user is an Owner/Manager and
 * the office is in `state: pending` + `source: fresh`, we redirect them to
 * the setup wizard. Other users see the wrapped component normally.
 *
 * Pre-existing offices (with no `onboarding` field) default to "completed",
 * so they're never redirected.
 */
export function WizardAutoRedirect({ children }: { children: React.ReactNode }) {
  const { autoLaunchWizard, isLoading } = useOnboarding();
  const [location] = useLocation();

  // While loading, render children rather than flashing a loader — the wizard
  // redirect, if needed, will fire on next render once onboarding is known.
  if (isLoading) return <>{children}</>;

  if (autoLaunchWizard && location !== "/setup") {
    return <Redirect to="/setup" />;
  }

  return <>{children}</>;
}
