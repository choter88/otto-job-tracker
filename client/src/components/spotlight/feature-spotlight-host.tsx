// App-root host for the spotlight system. Composes the orchestrator
// with the "What's new" archive and listens for a global event that
// the user menu fires to open the archive (avoids prop-drilling).
//
// Authenticated routes only — we suppress everything before the user
// is signed in so spotlights never appear over the auth screen.

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { trackSpotlightEvent } from "@/lib/spotlight-telemetry";
import { FeatureSpotlightOrchestrator } from "./feature-spotlight-orchestrator";
import { WhatsNewArchive } from "./whats-new-archive";

export const SPOTLIGHT_OPEN_ARCHIVE_EVENT = "otto:spotlight-open-archive";
export const SPOTLIGHT_REPLAY_EVENT = "otto:spotlight-replay";
/**
 * Event fired by the spotlight system to ask the dashboard to open
 * the office Settings modal pre-selected to a particular tab. Decoupled
 * via a window event so the spotlight components don't need a handle
 * to the dashboard's settings state.
 */
export const OPEN_OFFICE_SETTINGS_EVENT = "otto:open-office-settings";
/**
 * Ask the dashboard to open the Job Details modal for a given job id,
 * optionally deep-linked to a particular tab. Mirrors the
 * OPEN_OFFICE_SETTINGS_EVENT pattern so callers (toasts, notification
 * bell, spotlights) don't need a handle to the table's state. The
 * jobs-table listener resolves the id to a Job row from its query
 * cache when the event fires.
 */
export const OPEN_JOB_DETAILS_EVENT = "otto:open-job-details";

export function openSpotlightArchive() {
  window.dispatchEvent(new CustomEvent(SPOTLIGHT_OPEN_ARCHIVE_EVENT));
}

export function replaySpotlight(featureId: string) {
  window.dispatchEvent(
    new CustomEvent(SPOTLIGHT_REPLAY_EVENT, { detail: { featureId } }),
  );
}

export function openOfficeSettings(tab?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_OFFICE_SETTINGS_EVENT, { detail: { tab } }),
  );
}

export function openJobDetails(
  jobId: string,
  tab?: "overview" | "comments" | "tracking" | "related",
) {
  window.dispatchEvent(
    new CustomEvent(OPEN_JOB_DETAILS_EVENT, { detail: { jobId, tab } }),
  );
}

export function FeatureSpotlightHost() {
  const { user } = useAuth();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [forcedTour, setForcedTour] = useState<string | null>(null);

  useEffect(() => {
    const onOpenArchive = () => {
      trackSpotlightEvent("spotlight_archive_opened");
      setArchiveOpen(true);
    };
    const onReplay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.featureId) {
        trackSpotlightEvent("spotlight_archive_replay", { featureId: detail.featureId });
        setForcedTour(detail.featureId);
      }
    };
    window.addEventListener(SPOTLIGHT_OPEN_ARCHIVE_EVENT, onOpenArchive);
    window.addEventListener(SPOTLIGHT_REPLAY_EVENT, onReplay);
    return () => {
      window.removeEventListener(SPOTLIGHT_OPEN_ARCHIVE_EVENT, onOpenArchive);
      window.removeEventListener(SPOTLIGHT_REPLAY_EVENT, onReplay);
    };
  }, []);

  if (!user) return null;

  return (
    <>
      <FeatureSpotlightOrchestrator
        forcedTourFeatureId={forcedTour}
        onForcedTourConsumed={() => setForcedTour(null)}
      />
      <WhatsNewArchive open={archiveOpen} onOpenChange={setArchiveOpen} />
    </>
  );
}
