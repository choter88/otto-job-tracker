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

// req 8: the single Team activity feed (today.tsx right column) surfaces
// these event types: reverse-chron, staff initials + relative time. Kept
// separate from DEFAULT_ACTIVITY_FILTER/ACTIVITY_CATALOG (the user-editable
// "Since last login" filter) since this feed isn't user-configurable.
// chase_attempt is intentionally excluded; it's already surfaced on the
// Needs attention (chase) card.
export const TEAM_ACTIVITY_FILTER: ActivityType[] = ["status_change", "comment", "attempt", "snooze"];

// Default queue statuses reference the seeded office customStatuses IDs; they are
// validated against the office's actual list in resolveTodayConfig.
export function defaultTodayConfig(): TodayConfig {
  return {
    slots: [
      { type: "queue", mode: "outreach", title: "Call patients ready for pickup",
        statusIds: ["ready_for_pickup"] },
      { type: "queue", mode: "chase", title: "Overdue",
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
    // M8: the center owner-only "team" slot is cut too. Team activity now
    // lives once, in the right column (see today.tsx), so "team" is coerced
    // away the same way, even if still persisted from before the cut.
    if (slot.type === "stats" || slot.type === "analytics" || slot.type === "team") {
      return fallback;
    }
    if (slot.type !== "queue") {
      // Every current non-queue TileType ("stats", "analytics", "team") is
      // already coerced away above; this only guards a future tile type
      // added to TileType without a resolution rule yet; treat it as
      // owner/manager-only same as the tiles above did.
      return privileged ? slot : fallback;
    }
    const validIds = (slot.statusIds ?? []).filter((id) => validSet.has(id));
    const safeIds = validIds.length
      ? validIds
      : (fallback.statusIds ?? []).filter((id) => validSet.has(id));
    // Queue slot titles are canonical now (outreach = "Call patients ready
    // for pickup", chase = "Overdue"), so always use the current default
    // title for this mode rather than any stored slot.title. This fixes
    // existing users whose persisted preferences.todayConfig still carries
    // a stale title from an earlier copy revision; the stored value is
    // never surfaced.
    const mode = slot.mode ?? fallback.mode;
    const canonicalTitle = defaultTodayConfig().slots.find((s) => s.mode === mode)?.title ?? fallback.title;
    return { type: "queue", mode, title: canonicalTitle, statusIds: safeIds };
  }) as [SlotConfig, SlotConfig];

  const filter = (stored.activityFilter ?? DEFAULT_ACTIVITY_FILTER).filter(
    (t): t is ActivityType => ACTIVITY_CATALOG.some((a) => a.type === t),
  );

  return { slots, activityFilter: filter.length ? filter : [...DEFAULT_ACTIVITY_FILTER] };
}

// Drizzle `mode: "timestamp_ms"` columns are JS `Date` objects server-side,
// but `GET /api/jobs` serializes the response with `res.json(jobs)`: the
// default Express/JSON serializer calls `Date.prototype.toJSON()`, turning
// every Date into an ISO 8601 string over the wire. The client has no date
// reviver, so by the time a job reaches this helper, `statusChangedAt` /
// `snoozedUntil` are ISO strings, not Dates or numbers. Parse that shape
// explicitly rather than falling through to `Number(v)` (NaN/0 for a string).
function toMs(v: Date | number | string | null | undefined): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

// Queue membership: jobs whose current status is in statusIds, oldest-first
// (longest time since entering the current status). Jobs snoozed into the
// future (snoozedUntil > nowMs) are excluded; null/past snooze is included.
export function selectQueueJobs<
  T extends {
    status: string;
    statusChangedAt: number | Date | string;
    snoozedUntil?: number | Date | string | null;
  },
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

export const ACTIVITY_FEED_CAP = 10;

// Pure: cap a (caller-sorted, newest-first) feed at `limit` items, reporting
// how many were hidden so the caller can render a "view more" affordance.
// Used by the Team activity feed (req 8): the feed itself can be arbitrarily
// long over a 24h window, but the tile only ever shows the first page.
export function capActivityFeed(
  items: ActivityFeedItem[],
  limit: number = ACTIVITY_FEED_CAP,
): { shown: ActivityFeedItem[]; hiddenCount: number } {
  return { shown: items.slice(0, limit), hiddenCount: Math.max(0, items.length - limit) };
}
