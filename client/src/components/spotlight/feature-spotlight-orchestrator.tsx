// Decides which spotlight UI to render given the active set + current
// user state. One instance is mounted near the app root.
//
// Render priority per render:
//   1. If a higher-priority modal is open (any other [role=dialog]), do
//      nothing — never stack on top of the user's own work.
//   2. If exactly one feature is "first appearance" and has a modal,
//      render the What's New modal for it.
//   3. If a tour is active (modal CTA was clicked), render the
//      coachmark for the current step.
//   4. For every active feature with `pulseUntilClicked`, render a
//      pulse dot anchored to each undismissed step's target.
//
// Internal "tour cursor" state lives in this component (per session) —
// step progression doesn't need to persist across reloads.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFeatureSpotlights, type ActiveSpotlight } from "@/hooks/use-feature-spotlights";
import { useSpotlightTargetEl } from "@/lib/spotlight-target";
import { trackSpotlightEvent } from "@/lib/spotlight-telemetry";
import { SpotlightPulse } from "./spotlight-pulse";
import { SpotlightCoachmark } from "./spotlight-coachmark";
import { WhatsNewModal } from "./whats-new-modal";
import { openOfficeSettings } from "./feature-spotlight-host";
import { PatientTrackingInlineWidget } from "./patient-tracking-inline-widget";
import type { FeatureSpotlight, SpotlightTarget } from "@shared/feature-spotlights";

interface OrchestratorProps {
  /** Optional override (used when the user re-replays from the
   *  archive). When set, this feature's tour starts immediately. */
  forcedTourFeatureId?: string | null;
  onForcedTourConsumed?: () => void;
}

interface TourState {
  featureId: string;
  stepIndex: number;
}

export function FeatureSpotlightOrchestrator({
  forcedTourFeatureId,
  onForcedTourConsumed,
}: OrchestratorProps) {
  const {
    isReady,
    activeSpotlights,
    dismissModal,
    startTour,
    completeTour,
    skipTour,
    dismissPulse,
    markTargetClicked,
  } = useFeatureSpotlights();
  const queryClient = useQueryClient();

  // Tour cursor — when set, render the coachmark for that step.
  const [tour, setTour] = useState<TourState | null>(null);
  // Tracks which feature's modal is currently visible.
  const [modalFor, setModalFor] = useState<string | null>(null);
  // Latched ON state for the patient-tracking inline-widget toggle.
  // When the user flips auto-generate ON inside the modal, this flips
  // to true and stays true for the modal's lifetime so the primary CTA
  // reads "Done" (and dismisses) instead of "Open Tracking Links
  // settings" (which is the right next step only when still OFF).
  const [trackingToggleAcceptedInModal, setTrackingToggleAcceptedInModal] = useState(false);
  // Tracks open modals/dialogs in the app to suppress spotlights when
  // the user is already busy.
  const [appHasOpenDialog, setAppHasOpenDialog] = useState(false);

  useEffect(() => {
    const detect = () => {
      // Look for any visible role=dialog that isn't ours. Our spotlight
      // dialogs use specific testids, so we exclude them by attribute.
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog]"));
      let blocking = false;
      for (const d of dialogs) {
        const tid = d.getAttribute("data-testid") || "";
        if (tid.startsWith("whats-new-") || tid.startsWith("spotlight-")) continue;
        if (d.getAttribute("data-state") === "closed") continue;
        blocking = true;
        break;
      }
      setAppHasOpenDialog(blocking);
    };
    detect();
    const obs = new MutationObserver(detect);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "role"] });
    return () => obs.disconnect();
  }, []);

  // ── Forced replay (from the What's New archive) ─────────────────────
  // Re-runs the spotlight's show-me action regardless of dismissal
  // state. Branches the same way `handleModalShowMe` does so a feature
  // with `onShowMe: open-settings` deep-links into settings instead of
  // attempting an empty tour.
  useEffect(() => {
    if (!forcedTourFeatureId) return;
    const feature = activeSpotlights.find((s) => s.feature.id === forcedTourFeatureId)?.feature;
    onForcedTourConsumed?.();
    if (!feature) return;

    const action = feature.onShowMe ?? { kind: "tour" as const };
    if (action.kind === "open-settings") {
      openOfficeSettings(action.tab);
      return;
    }
    if (action.kind === "none") return;
    if (feature.steps.length === 0) return;
    setTour({ featureId: forcedTourFeatureId, stepIndex: 0 });
  }, [forcedTourFeatureId, onForcedTourConsumed, activeSpotlights]);

  // ── Pick the spotlight that should "own" this session ───────────────
  //
  // Show the modal for the highest-priority (oldest) first-appearance
  // feature that has a modal. Other active features still get pulses.
  const eligibleForModal = useMemo<ActiveSpotlight | null>(() => {
    if (!isReady || appHasOpenDialog) return null;
    if (tour) return null; // Don't show modal while a tour runs.
    const candidates = activeSpotlights
      .filter((s) => s.feature.modal && s.isFirstAppearance)
      .sort((a, b) => (a.feature.releasedAt < b.feature.releasedAt ? -1 : 1));
    return candidates[0] ?? null;
  }, [isReady, appHasOpenDialog, activeSpotlights, tour]);

  // Open modal whenever it changes.
  useEffect(() => {
    if (eligibleForModal && modalFor !== eligibleForModal.feature.id) {
      setModalFor(eligibleForModal.feature.id);
      setTrackingToggleAcceptedInModal(false);
      trackSpotlightEvent("spotlight_modal_seen", { featureId: eligibleForModal.feature.id });
    }
    if (!eligibleForModal && modalFor) {
      setModalFor(null);
    }
  }, [eligibleForModal, modalFor]);

  const modalFeature = useMemo<FeatureSpotlight | null>(() => {
    if (!modalFor) return null;
    return activeSpotlights.find((s) => s.feature.id === modalFor)?.feature ?? null;
  }, [modalFor, activeSpotlights]);

  const handleModalShowMe = useCallback(() => {
    if (!modalFeature) return;
    trackSpotlightEvent("spotlight_modal_show_me", { featureId: modalFeature.id });
    // Default to the tour kind so legacy entries without an explicit
    // `onShowMe` continue to behave the same way.
    const action = modalFeature.onShowMe ?? { kind: "tour" as const };
    setModalFor(null);

    switch (action.kind) {
      case "open-settings":
        // Mark as completed (not skipped) — the user followed our
        // recommended next-action; counts as engagement.
        completeTour(modalFeature.id);
        openOfficeSettings(action.tab);
        return;
      case "none":
        // Just dismiss. Modal copy alone was the point.
        completeTour(modalFeature.id);
        return;
      case "tour":
      default:
        // Multi-step coachmark tour. Bails to "completed" with no steps
        // rather than getting stuck in an empty cursor state.
        if (modalFeature.steps.length === 0) {
          completeTour(modalFeature.id);
          return;
        }
        trackSpotlightEvent("spotlight_tour_started", { featureId: modalFeature.id });
        startTour(modalFeature.id);
        setTour({ featureId: modalFeature.id, stepIndex: 0 });
        return;
    }
  }, [modalFeature, startTour, completeTour]);

  const handleModalDismiss = useCallback(() => {
    if (!modalFeature) return;
    trackSpotlightEvent("spotlight_modal_dismissed", { featureId: modalFeature.id });
    dismissModal(modalFeature.id);
    setModalFor(null);
  }, [modalFeature, dismissModal]);

  // ── Tour controls ───────────────────────────────────────────────────
  const tourFeature = useMemo<FeatureSpotlight | null>(() => {
    if (!tour) return null;
    return activeSpotlights.find((s) => s.feature.id === tour.featureId)?.feature
      ?? null;
  }, [tour, activeSpotlights]);

  const advanceTour = useCallback(() => {
    if (!tour || !tourFeature) return;
    const currentStep = tourFeature.steps[tour.stepIndex];
    if (currentStep) {
      trackSpotlightEvent("spotlight_tour_step_seen", {
        featureId: tour.featureId,
        stepId: currentStep.id,
        stepIndex: tour.stepIndex,
      });
    }
    const next = tour.stepIndex + 1;
    if (next >= tourFeature.steps.length) {
      trackSpotlightEvent("spotlight_tour_completed", { featureId: tour.featureId });
      completeTour(tour.featureId);
      setTour(null);
    } else {
      setTour({ featureId: tour.featureId, stepIndex: next });
    }
  }, [tour, tourFeature, completeTour]);

  const skipCurrentTour = useCallback(() => {
    if (!tour) return;
    trackSpotlightEvent("spotlight_tour_skipped", {
      featureId: tour.featureId,
      atStep: tour.stepIndex,
    });
    skipTour(tour.featureId);
    setTour(null);
  }, [tour, skipTour]);

  return (
    <>
      {modalFeature && (() => {
        // Patient-tracking spotlight gets an embedded auto-generate
        // toggle (commit 3, task J). When the user flips it ON via
        // the widget, the primary CTA flips from "Open Tracking Links
        // settings" to "Done" because the user has already done the
        // thing the deep-link would help them do.
        const isPatientTracking = modalFeature.id === "patient-tracking-2026-05";
        const widget = isPatientTracking ? (
          <PatientTrackingInlineWidget
            onTurnedOn={() => setTrackingToggleAcceptedInModal(true)}
          />
        ) : undefined;
        const primaryOverride = trackingToggleAcceptedInModal ? "Done" : undefined;
        const onPrimaryOverride = trackingToggleAcceptedInModal
          ? () => {
              trackSpotlightEvent("spotlight_modal_show_me", { featureId: modalFeature.id });
              completeTour(modalFeature.id);
              setModalFor(null);
            }
          : undefined;
        return (
          <WhatsNewModal
            open={!!modalFor}
            feature={modalFeature}
            onShowMe={handleModalShowMe}
            onDismiss={handleModalDismiss}
            inlineWidget={widget}
            primaryCtaLabelOverride={primaryOverride}
            onPrimaryClickOverride={onPrimaryOverride}
          />
        );
      })()}

      {/* Active tour — coachmark for current step */}
      {tour && tourFeature && (
        <TourStep
          feature={tourFeature}
          stepIndex={tour.stepIndex}
          onNext={advanceTour}
          onSkip={skipCurrentTour}
          onClose={skipCurrentTour}
        />
      )}

      {/* Pulse dots for everything else (skipped when a tour is running
          to avoid visual noise). */}
      {!tour && !appHasOpenDialog && activeSpotlights.map((s) => (
        s.feature.pulseUntilClicked !== false ? (
          <FeaturePulses
            key={s.feature.id}
            feature={s.feature}
            onTargetClick={(stepId) => {
              trackSpotlightEvent("spotlight_target_clicked", { featureId: s.feature.id, stepId });
              markTargetClicked(s.feature.id, stepId);
            }}
            onDismiss={() => {
              trackSpotlightEvent("spotlight_pulse_dismissed", { featureId: s.feature.id });
              dismissPulse(s.feature.id);
            }}
          />
        ) : null
      ))}
    </>
  );
}

// ── Tour step renderer ────────────────────────────────────────────────

function TourStep({
  feature,
  stepIndex,
  onNext,
  onSkip,
  onClose,
}: {
  feature: FeatureSpotlight;
  stepIndex: number;
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const step = feature.steps[stepIndex];
  // Wait for `waitFor` (if set) to appear in the DOM before resolving
  // the actual target. Lets us anchor inside a dialog without forcing
  // it open.
  const waitForEl = useSpotlightTargetEl(step.waitFor ?? null);
  const targetReady = step.waitFor ? !!waitForEl : true;
  const targetEl = useSpotlightTargetEl(targetReady ? step.target : null);

  if (!targetEl) {
    // Don't block — silently skip this step after a short grace, so a
    // missing testid doesn't trap the user.
    return <MissingTargetGuard onTimeout={onNext} />;
  }

  return (
    <SpotlightCoachmark
      target={targetEl}
      title={step.title}
      body={step.body}
      placement={step.placement}
      step={{ index: stepIndex, total: feature.steps.length }}
      onNext={onNext}
      onSkip={onSkip}
      onClose={onClose}
      cta={step.cta ? { label: step.cta.label } : undefined}
      testId={`spotlight-coachmark-${feature.id}-${step.id}`}
    />
  );
}

function MissingTargetGuard({ onTimeout }: { onTimeout: () => void }) {
  useEffect(() => {
    const t = setTimeout(onTimeout, 4000);
    return () => clearTimeout(t);
  }, [onTimeout]);
  return null;
}

// ── Pulse dots per feature ────────────────────────────────────────────

function FeaturePulses({
  feature,
  onTargetClick,
  onDismiss,
}: {
  feature: FeatureSpotlight;
  onTargetClick: (stepId: string) => void;
  onDismiss: () => void;
}) {
  // Show one pulse per step whose target is currently in the DOM. Avoid
  // showing pulses for steps whose `waitFor` host isn't open — they
  // would render at viewport (0,0) otherwise.
  return (
    <>
      {feature.steps.map((step) => (
        <PulseAnchor
          key={`${feature.id}-${step.id}`}
          target={step.target}
          waitFor={step.waitFor ?? null}
          onClick={() => onTargetClick(step.id)}
          onDismiss={onDismiss}
          ariaLabel={`New: ${step.title}`}
          testId={`spotlight-pulse-${feature.id}-${step.id}`}
        />
      ))}
    </>
  );
}

function PulseAnchor({
  target,
  waitFor,
  onClick,
  onDismiss,
  ariaLabel,
  testId,
}: {
  target: SpotlightTarget;
  waitFor: SpotlightTarget | null;
  onClick: () => void;
  onDismiss: () => void;
  ariaLabel: string;
  testId: string;
}) {
  const waitForEl = useSpotlightTargetEl(waitFor);
  const ready = waitFor ? !!waitForEl : true;
  const targetEl = useSpotlightTargetEl(ready ? target : null);

  // Detach a real-click listener so the user clicking the actual button
  // also dismisses the pulse (counts as engagement).
  useEffect(() => {
    if (!targetEl) return;
    const onRealClick = () => onClick();
    targetEl.addEventListener("click", onRealClick, { once: true });
    return () => targetEl.removeEventListener("click", onRealClick);
  }, [targetEl, onClick]);

  if (!targetEl) return null;
  return (
    <SpotlightPulse
      target={targetEl}
      onClick={onClick}
      onDismiss={onDismiss}
      ariaLabel={ariaLabel}
      testId={testId}
    />
  );
}
