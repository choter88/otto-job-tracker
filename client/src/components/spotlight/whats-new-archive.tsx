// Archive of past feature spotlights — opened from the user menu.
// Lists every active registry entry; clicking one resets that
// feature's state so the orchestrator re-shows the modal + tour next
// render.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { FEATURE_SPOTLIGHTS, type FeatureSpotlight } from "@shared/feature-spotlights";
import { useFeatureSpotlights } from "@/hooks/use-feature-spotlights";
import { replaySpotlight } from "@/components/spotlight/feature-spotlight-host";

interface WhatsNewArchiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewArchive({ open, onOpenChange }: WhatsNewArchiveProps) {
  const { rawState, resetFeature, enabledIds } = useFeatureSpotlights();

  // Sort newest-first, hiding entries the portal disabled.
  const items = FEATURE_SPOTLIGHTS
    .filter((f) => enabledIds.has(f.id))
    .slice()
    .sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : -1));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        <DialogHeader className="px-6 py-[18px] border-b border-line">
          <DialogTitle asChild>
            <div className="flex items-center gap-2.5 m-0">
              <Sparkles className="h-[18px] w-[18px] text-otto-accent" />
              <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0">
                What's new
              </h3>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-6 py-12 text-center text-ink-mute">
              No recent features.
            </div>
          ) : (
            <ul className="divide-y divide-line-2">
              {items.map((f) => (
                <ArchiveRow
                  key={f.id}
                  feature={f}
                  state={rawState?.[f.id]}
                  onReplay={() => {
                    // Reset state so the orchestrator considers it
                    // first-appearance again, then dispatch a forced
                    // tour event so the coachmark sequence runs even
                    // if the feature has no modal or the modal would
                    // otherwise be skipped.
                    resetFeature(f.id);
                    onOpenChange(false);
                    setTimeout(() => replaySpotlight(f.id), 0);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveRow({
  feature,
  state,
  onReplay,
}: {
  feature: FeatureSpotlight;
  state: any;
  onReplay: () => void;
}) {
  let releasedLabel: string | null = null;
  try {
    releasedLabel = format(new Date(feature.releasedAt), "MMM d, yyyy");
  } catch {
    releasedLabel = feature.releasedAt;
  }
  const dismissed = !!(state?.tourCompletedAt || state?.tourSkippedAt || state?.modalDismissedAt);

  return (
    <li className="flex items-start gap-3 px-6 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <h4 className="font-display text-[calc(15px*var(--ui-scale))] font-semibold text-ink m-0">
            {feature.name}
          </h4>
          {releasedLabel && (
            <span className="text-[calc(11px*var(--ui-scale))] text-ink-mute tabular-nums">
              {releasedLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-[calc(13px*var(--ui-scale))] text-ink-2 leading-snug m-0">
          {feature.shortDescription}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-[calc(12px*var(--ui-scale))] shrink-0"
        onClick={onReplay}
        data-testid={`whats-new-replay-${feature.id}`}
        title={dismissed ? "Replay this tour" : "Open this tour"}
      >
        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
        {dismissed ? "Replay" : "Show me"}
      </Button>
    </li>
  );
}
