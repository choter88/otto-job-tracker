/**
 * Usage event tracker — anonymous product analytics (no PHI).
 *
 * Events are buffered in memory and flushed to SQLite every 5 seconds
 * (or when the buffer reaches 100 entries). This avoids per-request
 * write contention on SQLite's single-writer lock.
 *
 * Daily aggregates are computed on demand at check-in time and shipped
 * to the portal. Raw events are retained locally for 90 days.
 */

import { createHash } from "crypto";
import { db } from "./db";
import { usageEvents } from "@shared/schema";
import { sql, and, gte, lt, asc } from "drizzle-orm";

// ── Event types ──────────────────────────────────────────────────────

export type UsageEventType =
  // Navigation
  | "tab_worklist"
  | "tab_important"
  | "tab_past_jobs"
  | "tab_overdue"
  | "tab_analytics"
  | "tab_team"
  // Jobs
  | "job_created"
  | "job_updated"
  | "job_status_changed"
  | "job_archived"
  | "job_deleted"
  | "job_bulk_update"
  | "job_restored"
  | "job_linked"
  | "job_unlinked"
  // Job detail views
  | "job_detail_viewed"
  | "job_detail_tab_overview"
  | "job_detail_tab_comments"
  | "job_detail_tab_related"
  // Comments
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
  // Custom columns
  | "custom_column_edited"
  // Search
  | "search_performed"
  // Import
  | "csv_import_started"
  | "csv_import_completed"
  // Auth
  | "user_login"
  | "user_logout"
  // Flags
  | "job_flagged"
  | "job_unflagged"
  // Settings
  | "settings_changed"
  // Notification rules
  | "notification_rule_created"
  | "notification_rule_updated"
  | "notification_rule_deleted"
  // Order-sheet automation (PDF watcher → parsed job)
  | "order_sheet_ingested"
  | "order_sheet_review_completed"
  | "order_sheet_learning_reset"
  | "order_sheet_auto_print_triggered"
  // Attachments (user-uploaded documents on a job)
  | "attachment_uploaded"
  | "attachment_deleted";

/** Allowlist for desktop-side event types (POST /api/track). */
export const CLIENT_TRACKABLE_EVENTS = new Set<string>([
  "tab_worklist",
  "tab_important",
  "tab_past_jobs",
  "tab_overdue",
  "tab_analytics",
  "tab_team",
  "search_performed",
  "job_detail_viewed",
  "job_detail_tab_overview",
  "job_detail_tab_comments",
  "job_detail_tab_related",
  "job_detail_tab_tracking",
  "custom_column_edited",
  // Patient tracking links — two distinct copy events so URL-only
  // and templated-message shares can be measured independently
  // (different paste targets, different downstream UX implications).
  // Each event carries a `metadata.source` indicating the surface
  // (toast | tracking_tab | configure_dialog) so we can also break
  // down where staff prefers to share from.
  "tracking_link_copy_url",
  "tracking_link_copy_message",
  // Legacy combined event — kept in the allowlist so old clients
  // (pre-split) don't get their events rejected during rollout.
  // New code uses the split events above.
  "tracking_link_copy_link",
  // Fired from the worklist row overflow's "Update tracker note" quick
  // editor — distinct from the in-tab note save so we can tell which
  // surface staff actually reach for.
  "tracking_link_quick_note_updated",
  // Spotlight system — telemetry for feature-adoption analysis. The
  // event metadata carries `featureId` and (for tour events) `stepId`.
  "spotlight_modal_seen",
  "spotlight_modal_dismissed",
  "spotlight_modal_show_me",
  "spotlight_tour_started",
  "spotlight_tour_step_seen",
  "spotlight_tour_completed",
  "spotlight_tour_skipped",
  "spotlight_pulse_dismissed",
  "spotlight_target_clicked",
  "spotlight_archive_opened",
  "spotlight_archive_replay",
  // Renderer-side auto-print signal: the office's host has watching on
  // AND the print bridge is available AND this is the machine that won
  // the ingest claim. Fired once per successful auto-print.
  "order_sheet_auto_print_triggered",
]);

/** Allowlist for tablet-side event types (POST /tablet/api/track). Kept
 *  small on purpose — tablets are a focused, low-volume surface, and the
 *  portal mainly cares "did the tablet do anything?" / "what was it doing?". */
export const TABLET_TRACKABLE_EVENTS = new Set<string>([
  "tablet_view_changed",
  "tablet_status_changed",
]);

export type UsageEventSource = "app" | "tablet";

// ── Event persistence ────────────────────────────────────────────────

/**
 * Prepared statement for single-row inserts. Created lazily on first use.
 * Using a prepared statement avoids re-parsing SQL on every call.
 */
let insertStmt: ReturnType<typeof db.insert> | null = null;

/**
 * Wall-clock time (ms) of the most recent tracked event since this process
 * started. Used by the license check-in scheduler as an idle signal —
 * "nothing has happened, no point talking to the portal." Reset to 0 on
 * process restart, so the first scheduled check-in after launch always
 * runs (it bypasses this gate via the startup path).
 */
let lastEventAt = 0;

export function getLastEventAt(): number {
  return lastEventAt;
}

/**
 * Track a usage event. Writes directly to SQLite on every call.
 * No in-memory buffering — events persist immediately and survive
 * crashes, restarts, and auto-updater cycles without data loss.
 *
 * Never throws — failures are silently ignored so tracking can't
 * break the main application flow.
 */
export function trackEvent(opts: {
  userId?: string | null;
  officeId?: string | null;
  eventType: UsageEventType | string;
  source?: UsageEventSource;
  metadata?: Record<string, any>;
}): void {
  try {
    db.insert(usageEvents).values({
      userId: opts.userId ?? null,
      officeId: opts.officeId ?? null,
      eventType: opts.eventType,
      source: opts.source ?? "app",
      metadata: opts.metadata ?? {},
      createdAt: new Date(),
    }).run();
    lastEventAt = Date.now();
  } catch {
    // Non-critical — never fail the caller
  }
}

// ── Aggregation (for check-in) ───────────────────────────────────────

export type DailyActivitySummary = {
  date: string;
  actions: Record<string, number>;
  activeUsers: number;
  sessions: number;
};

/**
 * Aggregate usage events into daily summaries since a given date.
 * Groups by calendar date (local timezone) and event type.
 */
export function getAggregatedDailyStats(since: Date): DailyActivitySummary[] {
  const sinceMs = since.getTime();

  // Query raw counts grouped by date and event_type
  const rows = db
    .select({
      date: sql<string>`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`,
      eventType: usageEvents.eventType,
      count: sql<number>`count(*)`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, new Date(sinceMs)))
    .groupBy(
      sql`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`,
      usageEvents.eventType,
    )
    .all();

  // Query distinct active users per day
  const userRows = db
    .select({
      date: sql<string>`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`,
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, new Date(sinceMs)))
    .groupBy(sql`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`)
    .all();

  // Query session counts (login events) per day
  const sessionRows = db
    .select({
      date: sql<string>`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`,
      sessions: sql<number>`count(*)`,
    })
    .from(usageEvents)
    .where(
      and(
        gte(usageEvents.createdAt, new Date(sinceMs)),
        sql`${usageEvents.eventType} = 'user_login'`,
      ),
    )
    .groupBy(sql`date(${usageEvents.createdAt} / 1000, 'unixepoch', 'localtime')`)
    .all();

  // Merge into daily summaries
  const dayMap = new Map<string, DailyActivitySummary>();

  for (const row of rows) {
    const date = String(row.date);
    if (!dayMap.has(date)) {
      dayMap.set(date, { date, actions: {}, activeUsers: 0, sessions: 0 });
    }
    dayMap.get(date)!.actions[String(row.eventType)] = Number(row.count);
  }

  for (const row of userRows) {
    const date = String(row.date);
    if (!dayMap.has(date)) {
      dayMap.set(date, { date, actions: {}, activeUsers: 0, sessions: 0 });
    }
    dayMap.get(date)!.activeUsers = Number(row.activeUsers);
  }

  for (const row of sessionRows) {
    const date = String(row.date);
    if (dayMap.has(date)) {
      dayMap.get(date)!.sessions = Number(row.sessions);
    }
  }

  return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Raw event export (for check-in) ─────────────────────────────────

export type RawUsageEvent = {
  userIdHash: string;
  eventType: string;
  source: UsageEventSource;
  metadata: Record<string, any>;
  occurredAt: number; // epoch ms
};

const MAX_RAW_EVENTS_PER_CHECKIN = 5000;

/** Hash cache to avoid rehashing the same userId repeatedly within a batch. */
function hashUserId(userId: string | null): string {
  if (!userId) return "anonymous";
  return createHash("sha256").update(userId).digest("hex");
}

/**
 * Return raw usage events since a given date, with userIds hashed.
 * Capped at 5000 events to bound payload size.
 */
export function getRawEventsSince(since: Date): RawUsageEvent[] {
  const rows = db
    .select({
      userId: usageEvents.userId,
      eventType: usageEvents.eventType,
      source: usageEvents.source,
      metadata: usageEvents.metadata,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))
    .orderBy(asc(usageEvents.createdAt))
    .limit(MAX_RAW_EVENTS_PER_CHECKIN)
    .all();

  const hashCache = new Map<string | null, string>();

  return rows.map((row) => {
    const key = row.userId;
    if (!hashCache.has(key)) hashCache.set(key, hashUserId(key));
    return {
      userIdHash: hashCache.get(key)!,
      eventType: row.eventType,
      source: (row.source === "tablet" ? "tablet" : "app") as UsageEventSource,
      metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, any>,
      occurredAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
    };
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────

/**
 * Delete usage events older than the specified number of days.
 */
export function pruneOldEvents(retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    db.delete(usageEvents)
      .where(lt(usageEvents.createdAt, new Date(cutoff)))
      .run();
  } catch {
    // Non-critical
  }
}
