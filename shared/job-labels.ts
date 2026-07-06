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

function toMs(v: Date | number): number {
  return v instanceof Date ? v.getTime() : v;
}

export function formatDaysInStatus(statusChangedAt: Date | number, nowMs: number = Date.now()): number {
  return Math.floor((nowMs - toMs(statusChangedAt)) / 86400000);
}
