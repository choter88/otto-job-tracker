// Pure grouping helper for the "Needs attention" (chase) tile: groups queued
// jobs by who currently holds them (a lab, or "in office" when the job hasn't
// shipped out yet), so the tile can render one group-header Call per lab
// instead of a per-row call. See shared/job-labels.ts for destination lookup
// and shared/today-defaults.ts for the queue selection this operates on.

import { getDestination, formatDaysInStatus } from "@shared/job-labels";

export type HolderGroup = {
  key: string; // 'in_office' or the orderDestination id
  kind: "in_office" | "lab";
  label: string; // 'In office' or the destination label
  phone?: string; // lab phone (undefined for in_office)
  destinationId?: string; // the orderDestination id (undefined for in_office)
  jobs: any[]; // rows sorted worst-first (largest days-in-status first)
  worstDays: number; // max days-in-status among its jobs (used to order groups)
};

function toTitleCase(id: string): string {
  return id
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function holderKey(job: any): string {
  return job.status === "job_created" ? "in_office" : job.orderDestination;
}

export function groupByHolder(jobs: any[], office: any, nowMs: number = Date.now()): HolderGroup[] {
  const byKey = new Map<string, HolderGroup>();

  for (const job of jobs) {
    const key = holderKey(job);
    let group = byKey.get(key);
    if (!group) {
      if (key === "in_office") {
        group = { key, kind: "in_office", label: "In office", jobs: [], worstDays: -Infinity };
      } else {
        const dest = getDestination(key, office);
        group = {
          key,
          kind: "lab",
          label: dest?.label ?? toTitleCase(key),
          phone: dest?.phone,
          destinationId: key,
          jobs: [],
          worstDays: -Infinity,
        };
      }
      byKey.set(key, group);
    }
    const days = formatDaysInStatus(job.statusChangedAt, nowMs);
    group.jobs.push(job);
    if (days > group.worstDays) group.worstDays = days;
  }

  const groups = Array.from(byKey.values());
  for (const group of groups) {
    group.jobs.sort(
      (a, b) => formatDaysInStatus(b.statusChangedAt, nowMs) - formatDaysInStatus(a.statusChangedAt, nowMs),
    );
  }
  groups.sort((a, b) => b.worstDays - a.worstDays);
  return groups;
}
