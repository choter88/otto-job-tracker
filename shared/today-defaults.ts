// Per-user "Today" dashboard configuration. Pure data + helpers, shared by the
// client, the server, and tests. No imports from app code.

export type TileType = "queue" | "analytics" | "stats" | "team";
export type QueueMode = "outreach" | "chase";
export type ActivityType =
  | "comment"
  | "status_change"
  | "overdue"
  | "star_note"
  | "attempt"
  | "snooze";

export interface SlotConfig {
  type: TileType;
  // queue-only fields:
  mode?: QueueMode; // "outreach" = Call patients, "chase" = Needs attention
  title?: string;
  statusIds?: string[];
}

export interface TodayConfig {
  slots: [SlotConfig, SlotConfig];
  activityFilter: ActivityType[];
}

export const ACTIVITY_CATALOG: { type: ActivityType; label: string }[] = [
  { type: "comment", label: "New comments" },
  { type: "status_change", label: "Status changes" },
  { type: "overdue", label: "Newly overdue" },
  { type: "star_note", label: "Stars & notes" },
];

export const DEFAULT_ACTIVITY_FILTER: ActivityType[] = ["comment", "overdue", "star_note"];

// Default queue statuses reference the seeded office customStatuses IDs; they are
// validated against the office's actual list in resolveTodayConfig.
export function defaultTodayConfig(): TodayConfig {
  return {
    slots: [
      { type: "queue", mode: "outreach", title: "Call patients ready for pickup",
        statusIds: ["ready_for_pickup"] },
      { type: "queue", mode: "chase", title: "Needs attention",
        statusIds: ["job_created", "ordered", "in_progress", "delayed"] },
    ],
    activityFilter: [...DEFAULT_ACTIVITY_FILTER],
  };
}

// Per-role defaults. Currently identical; the capability to set non-queue tiles
// is gated by role in resolveTodayConfig (and the Edit UI), not by the defaults.
export const DEFAULT_TODAY_CONFIG: Record<string, TodayConfig> = {
  owner: defaultTodayConfig(),
  manager: defaultTodayConfig(),
  staff: defaultTodayConfig(),
  view_only: defaultTodayConfig(),
  super_admin: defaultTodayConfig(),
};

const PRIVILEGED_ROLES = new Set(["owner", "manager"]);

function readStoredConfig(prefs: unknown): TodayConfig | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as Record<string, unknown>).todayConfig;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Partial<TodayConfig>;
  if (!Array.isArray(cfg.slots) || cfg.slots.length !== 2) return null;
  if (!cfg.slots.every((s) => s && typeof s === "object")) return null;
  return cfg as TodayConfig;
}

export function resolveTodayConfig(
  prefs: unknown,
  role: string,
  validStatusIds: string[],
): TodayConfig {
  const base = DEFAULT_TODAY_CONFIG[role] ?? defaultTodayConfig();
  const stored = readStoredConfig(prefs) ?? base;
  const validSet = new Set(validStatusIds);
  const privileged = PRIVILEGED_ROLES.has(role);

  const slots = stored.slots.map((slot, i): SlotConfig => {
    const fallback = base.slots[i] ?? defaultTodayConfig().slots[i];
    // The owner "stats strip" (StatsTile / office snapshot) is cut: "stats"
    // and legacy "analytics" never survive resolution, even if a user's
    // preferences.todayConfig still has one persisted from before the cut.
    if (slot.type === "stats" || slot.type === "analytics") {
      return fallback;
    }
    if (slot.type !== "queue") {
      // Non-queue tiles (e.g. "team") are owner/manager only; coerce others to the base queue.
      return privileged ? slot : fallback;
    }
    const validIds = (slot.statusIds ?? []).filter((id) => validSet.has(id));
    const safeIds = validIds.length
      ? validIds
      : (fallback.statusIds ?? []).filter((id) => validSet.has(id));
    return { type: "queue", mode: slot.mode ?? fallback.mode, title: slot.title ?? fallback.title, statusIds: safeIds };
  }) as [SlotConfig, SlotConfig];

  const filter = (stored.activityFilter ?? DEFAULT_ACTIVITY_FILTER).filter(
    (t): t is ActivityType => ACTIVITY_CATALOG.some((a) => a.type === t),
  );

  return { slots, activityFilter: filter.length ? filter : [...DEFAULT_ACTIVITY_FILTER] };
}

function toMs(v: number | Date): number {
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

// Queue membership: jobs whose current status is in statusIds, oldest-first
// (longest time since entering the current status). Jobs snoozed into the
// future (snoozedUntil > nowMs) are excluded; null/past snooze is included.
export function selectQueueJobs<
  T extends { status: string; statusChangedAt: number | Date; snoozedUntil?: number | Date | null },
>(jobs: T[], statusIds: string[], nowMs: number = Date.now()): T[] {
  const set = new Set(statusIds);
  return jobs
    .filter((j) => set.has(j.status))
    .filter((j) => !(j.snoozedUntil && toMs(j.snoozedUntil) > nowMs))
    .sort((a, b) => toMs(a.statusChangedAt) - toMs(b.statusChangedAt));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Boundary for the "Since last login" feed: the user's last sign-out, or the
// last 24h when we have no recorded sign-out (e.g. app closed without logout).
export function boundaryFor(lastSignoutAt: number | null | undefined, nowMs: number): number {
  return typeof lastSignoutAt === "number" && lastSignoutAt > 0 ? lastSignoutAt : nowMs - DAY_MS;
}

// --- Activity feed (used by server getActivityFeed + the client tiles) ---

export interface ActivityFeedItem {
  id: string;            // e.g. "comment:<commentId>"
  type: ActivityType;
  at: number;            // ms
  jobId: string;
  jobLabel: string;      // "Peter Cho · Glasses"
  actor: { id: string; firstName: string; lastName: string } | null;
  verb: string;          // "commented on" | "moved to In Progress" | "starred" | "became overdue"
  detail?: string;       // comment text / note
}

// Pure: filter to events after `since` of the chosen types, newest first.
export function mergeActivity(
  items: ActivityFeedItem[],
  sinceMs: number,
  types: ActivityType[],
): ActivityFeedItem[] {
  const allow = new Set(types);
  return items.filter((i) => i.at > sinceMs && allow.has(i.type)).sort((a, b) => b.at - a.at);
}
