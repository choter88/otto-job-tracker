import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  buildTrackStatuses,
  chooseVariant,
  CANCELLED_STATUS_ID,
  getStepIndex,
  isCancelled,
  type LifecycleVariant,
  progressFraction,
  type StatusItem,
} from "@/lib/lifecycle";

interface LifecycleTrackProps {
  /** All statuses defined by the office (including cancelled). */
  statuses: StatusItem[];
  /** Current status id of the job. */
  currentStatusId: string;
  /** Force a specific variant (skip auto-detect). */
  variant?: LifecycleVariant;
  /** Hide the status name below — use when space is extremely tight. */
  hideLabel?: boolean;
  /** Available width hint for variant auto-detect. */
  availableWidthPx?: number;
  /** Called when the user picks a new status from the inline menu. */
  onStatusChange?: (newStatusId: string) => void;
  /** If false, no menu opens and no chevron is shown. */
  interactive?: boolean;
  /** Compact = smaller segment height (worklist row); default = larger. */
  size?: "compact" | "default";
  className?: string;
}

/**
 * Dynamic lifecycle progress visualization.
 *
 * - Renders one segment per status (excluding `cancelled`).
 * - Past segments filled with `--ink-3`, current with `--accent`, future muted.
 * - Status name shown below the track (no abbreviation).
 * - Click anywhere on the track opens a status picker (when `interactive`).
 * - For `cancelled` jobs the track dims and shows "Cancelled".
 * - Auto-falls-back to a single fill bar when there are >8 statuses or width is tight.
 */
export default function LifecycleTrack({
  statuses,
  currentStatusId,
  variant: forcedVariant,
  hideLabel = false,
  availableWidthPx,
  onStatusChange,
  interactive = true,
  size = "compact",
  className,
}: LifecycleTrackProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const track = useMemo(() => buildTrackStatuses(statuses), [statuses]);
  const variant = forcedVariant || chooseVariant(track, availableWidthPx);
  const stepIdx = getStepIndex(track, currentStatusId);
  const cancelled = isCancelled(currentStatusId);

  const currentLabel = cancelled
    ? "Cancelled"
    : track[stepIdx]?.label || currentStatusId || "—";

  const trackEl = variant === "meter"
    ? <MeterTrack pct={cancelled ? 0 : progressFraction(track, currentStatusId)} cancelled={cancelled} size={size} />
    : <SegmentsTrack track={track} stepIdx={stepIdx} cancelled={cancelled} size={size} />;

  const labelEl = !hideLabel && (
    <span
      className={cn(
        "text-[calc(12px*var(--ui-scale))] font-medium leading-tight tracking-[-0.005em] truncate",
        cancelled ? "text-ink-mute line-through" : "text-ink-2",
      )}
      data-testid="lifecycle-label"
    >
      {currentLabel}
    </span>
  );

  const chevron = interactive && (
    <ChevronDown className="h-3 w-3 text-ink-mute shrink-0" aria-hidden />
  );

  // Layout: track on top, label + chevron below.
  const body = (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      {trackEl}
      {!hideLabel && (
        <div className="flex items-center gap-1 min-w-0">
          {labelEl}
          {chevron}
        </div>
      )}
    </div>
  );

  if (!interactive || !onStatusChange) {
    return body;
  }

  // One-click advance: the most common status edit by far is "move to the
  // next step", so it gets its own arrow beside the picker instead of
  // requiring open-menu → find → click. Hidden on the last status and on
  // cancelled jobs (there's no "next"). A sibling of the dropdown trigger,
  // not a child — nested buttons are invalid HTML and Radix opens its menu
  // on pointerdown, which would swallow the click.
  const nextStatus = !cancelled && stepIdx >= 0 && stepIdx < track.length - 1 ? track[stepIdx + 1] : null;
  const advanceEl = nextStatus && (
    <button
      type="button"
      className={cn(
        "shrink-0 self-end mb-px rounded p-0.5 text-otto-accent-ink",
        "hover:bg-otto-accent-soft hover:text-otto-accent-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={`Move to ${nextStatus.label}`}
      aria-label={`Move to ${nextStatus.label}`}
      data-testid="lifecycle-advance"
      onClick={(e) => {
        e.stopPropagation();
        onStatusChange(nextStatus.id);
      }}
    >
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  // Interactive: wrap in a dropdown trigger.
  return (
    <div className="flex items-stretch gap-0.5 min-w-0 max-w-full">
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "min-w-0 max-w-full text-left rounded p-1 -m-1",
            "hover:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={`Status: ${currentLabel}. Click to change.`}
          data-testid="lifecycle-track-trigger"
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" data-testid="lifecycle-status-menu">
        <DropdownMenuLabel className="text-[calc(10.5px*var(--ui-scale))] uppercase tracking-[0.10em] text-ink-mute font-semibold py-2 px-3">
          Set status
        </DropdownMenuLabel>
        {track.map((s) => {
          const isCurrent = s.id === currentStatusId;
          const dotColor = s.color || "var(--ink-3)";
          return (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                onStatusChange(s.id);
                setMenuOpen(false);
              }}
              data-testid={`status-menu-item-${s.id}`}
              className={cn(isCurrent && "bg-otto-accent-soft text-otto-accent-ink")}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: dotColor }}
                aria-hidden
              />
              <span>{s.label}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onStatusChange(CANCELLED_STATUS_ID);
            setMenuOpen(false);
          }}
          className="text-danger focus:text-danger"
          data-testid="status-menu-item-cancelled"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />
          Cancel job
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {advanceEl}
    </div>
  );
}

// ── Visual primitives ─────────────────────────────────────────────────

function SegmentsTrack({
  track,
  stepIdx,
  cancelled,
  size,
}: {
  track: StatusItem[];
  stepIdx: number;
  cancelled: boolean;
  size: "compact" | "default";
}) {
  // Fixed pill width (not flex-grow) so every pill is the same size in
  // every row, regardless of how many are filled or how wide the column
  // is. Earlier `flex-1 max-w-[18px]` distributed leftover cell space
  // unevenly when some pills were filled (bg-ink-3, opaque) and others
  // were `bg-line-strong/30` (semi-transparent), creating the appearance
  // that pills grew as the job progressed.
  const segHeight = size === "compact" ? 6 : 8;
  const segWidth = size === "compact" ? 16 : 20;
  return (
    <div className="flex gap-1 items-center min-w-0" aria-hidden>
      {track.map((s, i) => {
        const state = cancelled
          ? "cancelled"
          : i < stepIdx
            ? "done"
            : i === stepIdx
              ? "now"
              : "future";
        return (
          <span
            key={s.id}
            className={cn(
              "rounded shrink-0 transition-colors",
              state === "done" && "bg-ink-3",
              state === "now" && "bg-otto-accent",
              state === "future" && "bg-line-strong/30",
              state === "cancelled" && "bg-line-strong/20",
            )}
            style={{ height: `${segHeight}px`, width: `${segWidth}px` }}
            data-testid={`lifecycle-segment-${i}`}
            data-state={state}
          />
        );
      })}
    </div>
  );
}

function MeterTrack({
  pct,
  cancelled,
  size,
}: {
  pct: number;
  cancelled: boolean;
  size: "compact" | "default";
}) {
  const height = size === "compact" ? 5 : 6;
  return (
    <div
      className={cn(
        "w-full rounded-full overflow-hidden",
        cancelled ? "bg-line-strong/15" : "bg-paper-2",
      )}
      style={{ height: `${height}px`, minWidth: "60px" }}
      aria-hidden
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${Math.max(0, Math.min(100, pct * 100))}%`,
          background: cancelled
            ? "var(--ink-faint)"
            : "linear-gradient(90deg, var(--otto-accent), var(--brand-emerald-2))",
        }}
        data-testid="lifecycle-meter-fill"
      />
    </div>
  );
}
