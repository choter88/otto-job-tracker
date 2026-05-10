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

export function openSpotlightArchive() {
  window.dispatchEvent(new CustomEvent(SPOTLIGHT_OPEN_ARCHIVE_EVENT));
}

export function replaySpotlight(featureId: string) {
  window.dispatchEvent(
    new CustomEvent(SPOTLIGHT_REPLAY_EVENT, { detail: { featureId } }),
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
