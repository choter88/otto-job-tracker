// Single label map for job-type and order-destination display, so every UI
// surface routes enum -> label through the same lookup + fallback. See
// shared/office-defaults.ts for the shape of customJobTypes /
// customOrderDestinations, and client/src/components/today/job-queue-tile.tsx
// for the office?.settings?.<list> read pattern this mirrors.

function toTitleCase(id: string): string {
  return id
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getJobTypeLabel(jobTypeId: string, office: any): string {
  const customJobTypes = office?.settings?.customJobTypes ?? [];
  const match = customJobTypes.find((t: any) => t.id === jobTypeId);
  return match?.label ?? toTitleCase(jobTypeId);
}

export interface Destination {
  id: string;
  label: string;
  color?: string;
  phone?: string;
}

export function getDestination(destId: string, office: any): Destination | undefined {
  const customOrderDestinations = office?.settings?.customOrderDestinations ?? [];
  return customOrderDestinations.find((d: any) => d.id === destId);
}

export function getDestinationLabel(destId: string, office: any): string {
  return getDestination(destId, office)?.label ?? toTitleCase(destId);
}

// Drizzle `mode: "timestamp_ms"` columns are JS `Date` objects server-side,
// but `GET /api/jobs` serializes the response with `res.json(jobs)`: the
// default Express/JSON serializer calls `Date.prototype.toJSON()`, turning
// every Date into an ISO 8601 string over the wire. The client has no date
// reviver, so by the time a job reaches this helper, `statusChangedAt` is an
// ISO string, not a Date or number. Parse that shape explicitly.
function toMs(v: Date | number | string): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function formatDaysInStatus(statusChangedAt: Date | number | string, nowMs: number = Date.now()): number {
  return Math.floor((nowMs - toMs(statusChangedAt)) / 86400000);
}

// The customStatus with the smallest `order` strictly greater than the
// current status's order (i.e. the next step in the state machine, reading
// `order` rather than array position). Returns null when the current status
// id is unknown or already the last (largest `order`) status. Used to drive
// the Overdue card's per-row Advance action (see job-queue-tile.tsx).
export function getNextStatus(currentStatusId: string, office: any): { id: string; label: string } | null {
  const customStatuses = office?.settings?.customStatuses ?? [];
  const current = customStatuses.find((s: any) => s.id === currentStatusId);
  if (!current) return null;

  let next: any = null;
  for (const candidate of customStatuses) {
    if (candidate.order <= current.order) continue;
    if (!next || candidate.order < next.order) next = candidate;
  }
  return next ? { id: next.id, label: next.label } : null;
}
