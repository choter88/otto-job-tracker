import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  defaultOnboardingForExistingOffice,
  getOnboarding,
  type OnboardingState,
  type OnboardingStepId,
  markStepCompleted,
  markWizardCompleted,
  markWizardSkipped,
  resetWizardState,
  shouldAutoLaunchWizard,
  shouldShowSetupCard,
  shouldShowBackupRestoreBanner,
} from "@shared/onboarding";
import type { Office } from "@shared/schema";

/**
 * Read the current onboarding state and offer mutations to update it.
 *
 * The wizard treats `office.settings.onboarding` as the source of truth.
 * Each mutation patches the office with a partial settings payload — the
 * server merges (server/storage.ts:updateOffice), so other settings keys
 * are preserved.
 */
export function useOnboarding() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const officeQueryKey = ["/api/offices", user?.officeId];

  const { data: office, isLoading } = useQuery<Office>({
    queryKey: officeQueryKey,
    enabled: !!user?.officeId,
  });

  const onboarding: OnboardingState = office
    ? getOnboarding(office.settings)
    : defaultOnboardingForExistingOffice();

  const role = user?.role || null;

  const patchOnboardingMutation = useMutation({
    mutationFn: async (next: OnboardingState) => {
      const res = await apiRequest("PUT", `/api/offices/${user?.officeId}`, {
        settings: { onboarding: next },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: officeQueryKey });
    },
  });

  return {
    office,
    isLoading,
    onboarding,
    autoLaunchWizard: shouldAutoLaunchWizard(office?.settings, role),
    showSetupCard: shouldShowSetupCard(office?.settings, role),
    showBackupRestoreBanner: shouldShowBackupRestoreBanner(office?.settings, role),
    markStepCompleted: (step: OnboardingStepId) =>
      patchOnboardingMutation.mutateAsync(markStepCompleted(onboarding, step)),
    markWizardCompleted: () =>
      patchOnboardingMutation.mutateAsync(markWizardCompleted(onboarding)),
    markWizardSkipped: () =>
      patchOnboardingMutation.mutateAsync(markWizardSkipped(onboarding)),
    resetWizard: () => patchOnboardingMutation.mutateAsync(resetWizardState()),
    isPending: patchOnboardingMutation.isPending,
  };
}
