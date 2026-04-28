/**
 * Pure helpers for the dynamic LifecycleTrack component.
 *
 * Each office defines its own `customStatuses` list. The lifecycle track
 * reflects that list (excluding terminal `cancelled`) so the same component
 * works for an office with 5 statuses or 15.
 */

export type StatusItem = {
  id: string;
  label: string;
  color?: string;
  order?: number;
};

/** Threshold above which segments become too narrow to read; meter mode kicks in. */
export const MAX_SEGMENTS_BEFORE_METER = 8;

export const CANCELLED_STATUS_ID = "cancelled";

/**
 * Track statuses are everything except `cancelled`. The track represents the
 * forward path through the workflow.
 */
export function buildTrackStatuses(allStatuses: StatusItem[]): StatusItem[] {
  if (!Array.isArray(allStatuses)) return [];
  const filtered = allStatuses.filter((s) => s && s.id !== CANCELLED_STATUS_ID);
  // Stable sort by `order`, falling back to original index.
  return filtered
    .map((s, idx) => ({ ...s, _idx: idx }))
    .sort((a, b) => {
      const ao = typeof a.order === "number" ? a.order : a._idx;
      const bo = typeof b.order === "number" ? b.order : b._idx;
      return ao - bo;
    })
    .map(({ _idx: _, ...rest }) => rest as StatusItem);
}

/**
 * Index of the current status in the track, or -1 if the job is cancelled
 * or the status isn't found.
 */
export function getStepIndex(track: StatusItem[], statusId: string): number {
  if (statusId === CANCELLED_STATUS_ID) return -1;
  return track.findIndex((s) => s.id === statusId);
}

export type LifecycleVariant = "segments" | "meter";

/**
 * Decide which visual variant to render based on number of statuses and
 * available width. If width is unknown (e.g. SSR), default to segments and
 * let the consumer override.
 */
export function chooseVariant(track: StatusItem[], availableWidthPx?: number): LifecycleVariant {
  if (track.length > MAX_SEGMENTS_BEFORE_METER) return "meter";
  if (typeof availableWidthPx === "number") {
    // Each segment is ~14px wide + 4px gap. Plus the label space.
    const minSegmentSpace = track.length * 14 + (track.length - 1) * 4 + 12;
    if (availableWidthPx < minSegmentSpace) return "meter";
  }
  return "segments";
}

/**
 * Compute a 0-1 fraction for the meter variant given the current step and
 * total steps.
 */
export function progressFraction(track: StatusItem[], statusId: string): number {
  if (statusId === CANCELLED_STATUS_ID) return 0;
  const idx = getStepIndex(track, statusId);
  if (idx < 0) return 0;
  if (track.length <= 1) return idx >= 0 ? 1 : 0;
  return idx / (track.length - 1);
}

export function isCancelled(statusId: string): boolean {
  return statusId === CANCELLED_STATUS_ID;
}
