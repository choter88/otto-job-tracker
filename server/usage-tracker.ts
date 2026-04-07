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

import { db } from "./db";
import { usageEvents } from "@shared/schema";
import { sql, and, gte, lt } from "drizzle-orm";

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
  // Comments
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
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
  | "settings_changed";

/** Allowlist for client-side event types (POST /api/track). */
export const CLIENT_TRACKABLE_EVENTS = new Set<string>([
  "tab_worklist",
  "tab_important",
  "tab_past_jobs",
  "tab_overdue",
  "tab_analytics",
  "tab_team",
  "search_performed",
]);

// ── Buffer and flush ─────────────────────────────────────────────────

interface BufferedEvent {
  userId: string | null;
  officeId: string | null;
  eventType: string;
  metadata: Record<string, any>;
  createdAt: number;
}

const buffer: BufferedEvent[] = [];
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 100;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Track a usage event. Synchronous, fire-and-forget.
 * Never throws — failures are silently ignored.
 */
export function trackEvent(opts: {
  userId?: string | null;
  officeId?: string | null;
  eventType: UsageEventType | string;
  metadata?: Record<string, any>;
}): void {
  buffer.push({
    userId: opts.userId ?? null,
    officeId: opts.officeId ?? null,
    eventType: opts.eventType,
    metadata: opts.metadata ?? {},
    createdAt: Date.now(),
  });

  if (buffer.length >= FLUSH_THRESHOLD) {
    flushBuffer();
  }
}

function flushBuffer(): void {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0);
  try {
    const insert = db.insert(usageEvents);
    const values = batch.map((e) => ({
      userId: e.userId,
      officeId: e.officeId,
      eventType: e.eventType,
      metadata: e.metadata,
      createdAt: new Date(e.createdAt),
    }));
    insert.values(values).run();
  } catch {
    // Non-critical — silently discard on error
  }
}

export function startEventFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
}

export function stopEventFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush on shutdown
  flushBuffer();
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
