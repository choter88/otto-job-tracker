/**
 * Today Dashboard v2 (final review fix A): regression lock for the real
 * over-the-wire shape of timestamp_ms columns.
 *
 * Drizzle's `mode: "timestamp_ms"` columns (`statusChangedAt`,
 * `snoozedUntil`) come back as JS `Date` objects server-side, but
 * `GET /api/jobs` serializes the response with `res.json(jobs)` — Express's
 * default JSON serializer calls `Date.prototype.toJSON()`, turning every
 * Date into an ISO 8601 string. The client has no date reviver, so by the
 * time a job reaches `selectQueueJobs` / `formatDaysInStatus` on the client,
 * `statusChangedAt` and `snoozedUntil` are ISO strings, not Dates or numbers.
 *
 * This test feeds that REAL shape (ISO strings), not numeric literals, so it
 * exercises the exact bug: the old `toMs` coerced a string with
 * `Number(v) || 0`, which is NaN/0 for an ISO string. That silently broke:
 *   - snooze exclusion (snoozed rows never left the Today queue)
 *   - worst-first sort (all timestamps collapsed to 0)
 *   - days-in-status (rendered "NaN days")
 */

import test from "node:test";
import assert from "node:assert/strict";
import { selectQueueJobs } from "../shared/today-defaults";
import { formatDaysInStatus } from "../shared/job-labels";

const nowMs = Date.parse("2026-07-06T00:00:00.000Z");
const isoDaysAgo = (n: number) => new Date(nowMs - n * 86400000).toISOString();

function job(overrides: Record<string, any>) {
  return {
    id: overrides.id,
    status: overrides.status ?? "ready_for_pickup",
    statusChangedAt: overrides.statusChangedAt,
    snoozedUntil: overrides.snoozedUntil ?? null,
  };
}

test("formatDaysInStatus: ISO string statusChangedAt (the real /api/jobs shape) returns a real number, not NaN", () => {
  const iso = isoDaysAgo(5);
  const days = formatDaysInStatus(iso as any, nowMs);
  assert.equal(Number.isNaN(days), false, `expected a real number, got NaN for ISO input ${iso}`);
  assert.equal(days, 5);
});

test("selectQueueJobs: ISO string snoozedUntil in the future excludes the job from the queue", () => {
  const jobs = [
    job({ id: "not-snoozed", statusChangedAt: isoDaysAgo(10) }),
    job({
      id: "snoozed-future",
      statusChangedAt: isoDaysAgo(20),
      snoozedUntil: new Date(nowMs + 5 * 86400000).toISOString(),
    }),
  ];
  const out = selectQueueJobs(jobs as any, ["ready_for_pickup"], nowMs);
  assert.deepEqual(
    out.map((j) => j.id),
    ["not-snoozed"],
    "future-snoozed job (ISO snoozedUntil > now) must be excluded from the Today queue",
  );
});

test("selectQueueJobs: ISO string statusChangedAt sorts worst-first (oldest first)", () => {
  const jobs = [
    job({ id: "newest", statusChangedAt: isoDaysAgo(1) }),
    job({ id: "oldest", statusChangedAt: isoDaysAgo(30) }),
    job({ id: "middle", statusChangedAt: isoDaysAgo(10) }),
  ];
  const out = selectQueueJobs(jobs as any, ["ready_for_pickup"], nowMs);
  assert.deepEqual(
    out.map((j) => j.id),
    ["oldest", "middle", "newest"],
    "ISO-string statusChangedAt values must still sort oldest (worst) first",
  );
});

test("selectQueueJobs: ISO string snoozedUntil in the past does NOT exclude the job", () => {
  const jobs = [
    job({
      id: "snoozed-past",
      statusChangedAt: isoDaysAgo(15),
      snoozedUntil: new Date(nowMs - 2 * 86400000).toISOString(),
    }),
  ];
  const out = selectQueueJobs(jobs as any, ["ready_for_pickup"], nowMs);
  assert.deepEqual(out.map((j) => j.id), ["snoozed-past"]);
});
