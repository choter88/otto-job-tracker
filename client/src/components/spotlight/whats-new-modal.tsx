// What's New modal — shown once per session per spotlight when the
// spotlight first appears for a user. Centered Otto-branded card with
// optional media, body copy, and primary/secondary CTAs.
//
// `inlineWidget` is a generic slot rendered between the body copy and
// the CTA row — features that want to let the user act on the
// announcement without leaving the modal (e.g. flip a setting) plug
// their UI in here. Kept generic so future spotlights can reuse the
// affordance.

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import type { FeatureSpotlight } from "@shared/feature-spotlights";
import type { ReactNode } from "react";

interface WhatsNewModalProps {
  open: boolean;
  feature: FeatureSpotlight;
  onShowMe: () => void;
  onDismiss: () => void;
  /** Optional inline UI rendered between body copy and CTAs. */
  inlineWidget?: ReactNode;
  /** Overrides for the primary CTA — when the inline widget changes
   *  what the right next action is (e.g. "Done" instead of "Open
   *  Settings" after a toggle is flipped). */
  primaryCtaLabelOverride?: string;
  onPrimaryClickOverride?: () => void;
}

export function WhatsNewModal({
  open,
  feature,
  onShowMe,
  onDismiss,
  inlineWidget,
  primaryCtaLabelOverride,
  onPrimaryClickOverride,
}: WhatsNewModalProps) {
  const modal = feature.modal;
  if (!modal) return null;
  const primaryLabel = primaryCtaLabelOverride ?? modal.primaryCtaLabel ?? "Show me";
  const onPrimary = onPrimaryClickOverride ?? onShowMe;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden gap-0"
        data-testid={`whats-new-modal-${feature.id}`}
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-3 right-3 z-10 grid place-items-center h-7 w-7 rounded-md text-ink-mute hover:bg-line-2 hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {modal.media ? (
          <div className="aspect-[16/9] bg-otto-accent-soft border-b border-line overflow-hidden grid place-items-center">
            <img
              src={modal.media.src}
              alt={modal.media.alt ?? ""}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Hide broken image — the icon-tile below remains
                (e.currentTarget.parentElement as HTMLElement).style.display = "none";
              }}
            />
          </div>
        ) : null}

        <div className="px-6 pt-6 pb-5">
          {!modal.media && (
            // No media supplied — render a 64px indigo tile so the
            // modal still has a visual focal point. Same treatment the
            // patient tracking page uses for its hero icon.
            <div
              className="h-14 w-14 rounded-2xl bg-otto-accent text-white grid place-items-center mb-4"
              aria-hidden
            >
              <Sparkles className="h-6 w-6" />
            </div>
          )}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-otto-accent">
              New
            </span>
          </div>
          <h2 className="font-display text-[calc(22px*var(--ui-scale))] font-semibold tracking-tight text-ink m-0">
            {modal.title}
          </h2>
          <p className="mt-2 text-[calc(13.5px*var(--ui-scale))] leading-relaxed text-ink-2 m-0">
            {modal.body}
          </p>
          {inlineWidget && (
            <div className="mt-4" data-testid={`whats-new-${feature.id}-inline-widget`}>
              {inlineWidget}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-line bg-panel-2 px-6 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDismiss}
            data-testid={`whats-new-${feature.id}-dismiss`}
          >
            {modal.secondaryCtaLabel ?? "Maybe later"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={onPrimary}
            data-testid={`whats-new-${feature.id}-show-me`}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {primaryLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
