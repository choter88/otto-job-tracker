// What's New modal — shown once per session per spotlight when the
// spotlight first appears for a user. Centered Otto-branded card with
// optional media, body copy, and primary/secondary CTAs.

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import type { FeatureSpotlight } from "@shared/feature-spotlights";

interface WhatsNewModalProps {
  open: boolean;
  feature: FeatureSpotlight;
  onShowMe: () => void;
  onDismiss: () => void;
}

export function WhatsNewModal({ open, feature, onShowMe, onDismiss }: WhatsNewModalProps) {
  const modal = feature.modal;
  if (!modal) return null;

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

        {modal.media && (
          <div className="aspect-[16/9] bg-otto-accent-soft border-b border-line overflow-hidden grid place-items-center">
            <img
              src={modal.media.src}
              alt={modal.media.alt ?? ""}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Hide broken image, fall back to the icon header below
                (e.currentTarget.parentElement as HTMLElement).style.display = "none";
              }}
            />
          </div>
        )}

        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-otto-accent" aria-hidden />
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
            onClick={onShowMe}
            data-testid={`whats-new-${feature.id}-show-me`}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {modal.primaryCtaLabel ?? "Show me"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
