// Coachmark bubble — a pop-out tooltip with a directional arrow that
// anchors to a target element. Used inside a multi-step tour or as a
// one-shot hint. Built on Radix Popper so collision detection / flips
// happen automatically.
//
// Layout:
//   ┌──────────────────────────────┐
//   │ TITLE                        │
//   │ Body copy in a sentence or   │
//   │ two.                         │
//   │                              │
//   │ [● ○ ○]   [Skip]  [Next →]   │
//   └──────────────────────────────┘

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as Popper from "@radix-ui/react-popper";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ensureInView, useElementRect } from "@/lib/spotlight-target";

interface SpotlightCoachmarkProps {
  target: HTMLElement | null;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
  /** Multi-step tour controls. When present, shows a progress dot row +
   *  a Next button. When this is the last step, Next becomes Done. */
  step?: { index: number; total: number };
  onNext?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
  /** Optional inline CTA below body. */
  cta?: { label: string; href?: string; onClick?: () => void };
  testId?: string;
}

export function SpotlightCoachmark({
  target,
  title,
  body,
  placement = "bottom",
  step,
  onNext,
  onSkip,
  onClose,
  cta,
  testId,
}: SpotlightCoachmarkProps) {
  const rect = useElementRect(target);

  // Scroll the target into view once when the coachmark opens.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (target && !scrolledRef.current) {
      ensureInView(target);
      scrolledRef.current = true;
    }
  }, [target]);

  if (!target || !rect) return null;

  const isLastStep = step && step.index >= step.total - 1;

  // Build a virtual reference so Popper can position itself against the
  // *current* rect even as the target moves/scrolls.
  const virtualRef = {
    getBoundingClientRect: () => rect,
  } as unknown as Element;

  return createPortal(
    <Popper.Root>
      {/* Anchor */}
      <Popper.Anchor virtualRef={{ current: virtualRef }} />
      <Popper.Content
        side={placement}
        sideOffset={10}
        collisionPadding={12}
        className={cn(
          "z-[110] w-[300px] rounded-xl border border-line bg-panel p-4 shadow-xl",
          "animate-in fade-in-0 zoom-in-95",
        )}
        data-testid={testId}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-display text-[calc(14px*var(--ui-scale))] font-semibold tracking-tight text-ink m-0">
              {title}
            </h4>
            <p className="mt-1.5 text-[calc(12.5px*var(--ui-scale))] leading-relaxed text-ink-2 m-0">
              {body}
            </p>
            {cta && (
              <div className="mt-2.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[calc(11.5px*var(--ui-scale))]"
                  onClick={cta.onClick}
                >
                  {cta.label}
                </Button>
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid place-items-center h-6 w-6 rounded-md text-ink-mute hover:bg-line-2 hover:text-ink shrink-0"
              aria-label="Close"
              data-testid="spotlight-coachmark-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {(step || onNext || onSkip) && (
          <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-line-2 pt-2.5">
            {step && step.total > 1 ? (
              <div
                className="flex items-center gap-1"
                role="status"
                aria-label={`Step ${step.index + 1} of ${step.total}`}
              >
                {Array.from({ length: step.total }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-colors",
                      i === step.index ? "bg-otto-accent" : "bg-line-strong/50",
                    )}
                    aria-hidden
                  />
                ))}
              </div>
            ) : (
              <span aria-hidden />
            )}

            <div className="flex items-center gap-1.5">
              {onSkip && !isLastStep && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[calc(11.5px*var(--ui-scale))] text-ink-mute hover:text-ink"
                  onClick={onSkip}
                  data-testid="spotlight-coachmark-skip"
                >
                  Skip tour
                </Button>
              )}
              {onNext && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[calc(11.5px*var(--ui-scale))]"
                  onClick={onNext}
                  data-testid="spotlight-coachmark-next"
                >
                  {isLastStep ? "Done" : (
                    <>
                      Next
                      <ChevronRight className="h-3 w-3 ml-1" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        <Popper.Arrow className="fill-panel" width={12} height={6} />
      </Popper.Content>
    </Popper.Root>,
    document.body,
  );
}
