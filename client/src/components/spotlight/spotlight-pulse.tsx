// Persistent pulse indicator that follows a target element. Rendered
// into a portal so the pulse never gets clipped by the target's
// `overflow-hidden` ancestors. Click → fires `onClick`. Esc when
// focused → dismiss.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useElementRect } from "@/lib/spotlight-target";

interface SpotlightPulseProps {
  target: HTMLElement | null;
  /** Anchor corner on the target. Defaults to top-right. */
  anchor?: "tl" | "tr" | "bl" | "br";
  /** Pixel offset from the anchor (positive moves outward). */
  offset?: { x: number; y: number };
  onClick?: () => void;
  onDismiss?: () => void;
  ariaLabel: string;
  /** data-testid surfaced for tests. */
  testId?: string;
}

export function SpotlightPulse({
  target,
  anchor = "tr",
  offset = { x: -2, y: -2 },
  onClick,
  onDismiss,
  ariaLabel,
  testId,
}: SpotlightPulseProps) {
  const rect = useElementRect(target);
  const [hovered, setHovered] = useState(false);

  if (!target || !rect) return null;

  const x = anchor === "tl" || anchor === "bl" ? rect.left + offset.x : rect.right + offset.x;
  const y = anchor === "tl" || anchor === "tr" ? rect.top + offset.y : rect.bottom + offset.y;

  return createPortal(
    <div
      role="presentation"
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        zIndex: 90,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        data-testid={testId}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onDismiss) {
            e.stopPropagation();
            onDismiss();
          }
        }}
        className={cn(
          "relative grid place-items-center rounded-full",
          "h-[18px] w-[18px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-otto-accent focus-visible:ring-offset-1",
        )}
        style={{ pointerEvents: "auto" }}
      >
        {/* Outer ambient glow — always on, gives the dot weight against
            busy backgrounds without competing with the ping ring. */}
        <span
          className="absolute -inset-1 rounded-full bg-otto-accent/15 blur-[3px]"
          aria-hidden
        />
        {/* Ping ring */}
        <span
          className="absolute inset-0 rounded-full bg-otto-accent/45 animate-ping"
          aria-hidden
        />
        {/* Core dot — bigger, with a stronger white halo so it reads
            against any surface. */}
        <span
          className="absolute inset-[3px] rounded-full bg-otto-accent shadow-[0_0_0_2.5px_white]"
          aria-hidden
        />
        {/* Hover ring for affordance */}
        {hovered && (
          <span
            className="absolute -inset-2 rounded-full ring-2 ring-otto-accent/40"
            aria-hidden
          />
        )}
      </button>
    </div>,
    document.body,
  );
}
