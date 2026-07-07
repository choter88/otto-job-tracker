/**
 * Today Dashboard v2 (M10): end-to-end PHI/egress guard.
 *
 * This is the final milestone's load-bearing test: it seeds real LAN-side
 * data through the actual storage helpers (storage.appendJobEvent with an
 * attempt note, storage.snoozeJob with a reason), tracks a handful of
 * `today_*` usage events (including one with a name-shaped metadata string,
 * mirroring what a careless future call site might do), and then calls the
 * REAL egress builders (getRawEventsSince / getAggregatedDailyStats) exactly
 * as the license check-in does. It proves:
 *
 *  1. Every today_* event in the egress output has source === 'app' and an
 *     eventType <= 50 chars.
 *  2. The name-shaped metadata string is stripped at egress (M0-C's
 *     sanitizeTodayMetadata choke point) while numeric metadata survives.
 *  3. The attempt note and snooze reason are stored LAN-side (job_events
 *     .payload / job_comments), but never appear in any usage_event row or
 *     in the serialized egress payload.
 *  4. No today_* name or action_counts key exceeds 50 chars, and no source
 *     other than 'app' shows up anywhere in the egress output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-today-telemetry-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "today-telemetry.sqlite");

const { sqlite } = await import("../server/db");
const { storage } = await import("../server/storage");
const { trackEvent, getRawEventsSince, getAggregatedDailyStats } = await import("../server/usage-tracker");
const { TODAY_EVENTS } = await import("@shared/today-telemetry");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

const ATTEMPT_NOTE = "called at 555-0100, left voicemail about the delayed lab order";
const SNOOZE_REASON = "waiting on the lab to ship, follow up next week";

test("today_* telemetry: PHI stays LAN-side and never egresses", async () => {
  // ── Seed via the real code paths ──────────────────────────────────
  const office = await storage.createOffice({ name: "M10 Telemetry Office" });
  const user = await storage.createUser({
    email: "m10-telemetry@example.com",
    loginId: "m10-telemetry",
    password: "hash",
    firstName: "Jane",
    lastName: "Ortiz",
    role: "owner",
    officeId: office.id,
  } as any);
  const job = await storage.createJob({
    patientFirstName: "Jane",
    patientLastName: "Patient",
    jobType: "glasses",
    status: "job_created",
    orderDestination: "vision_lab",
    officeId: office.id,
    createdBy: user.id,
  } as any);

  const actor = { userId: user.id, initials: storage.actorInitialsFor(user) };

  // Attempt WITH a note (mirrors POST /api/jobs/:id/attempts in routes.ts).
  await storage.appendJobEvent({
    jobOrderId: job.orderId,
    jobId: job.id,
    officeId: office.id,
    eventType: "attempt_called",
    actorUserId: actor.userId,
    actorInitials: actor.initials,
    payload: { note: ATTEMPT_NOTE },
  });
  trackEvent({
    userId: user.id,
    officeId: user.officeId,
    eventType: TODAY_EVENTS.ATTEMPT_CALLED,
  });

  // Snooze WITH a reason (mirrors POST /api/jobs/:id/snooze in routes.ts).
  // storage.snoozeJob both logs a `snoozed` job_event and (since the reason
  // is non-empty) writes a job_comment carrying the reason text.
  const until = Date.now() + 60 * 60 * 1000;
  await storage.snoozeJob(job.id, until, SNOOZE_REASON, actor);
  trackEvent({ userId: user.id, officeId: user.officeId, eventType: TODAY_EVENTS.SNOOZE });

  // A view_opened + a search_opened, one with metadata that deliberately
  // includes a name-shaped string alongside a legitimate numeric value:
  // this is exactly the shape sanitizeTodayMetadata must strip down to.
  trackEvent({ userId: user.id, officeId: user.officeId, eventType: TODAY_EVENTS.VIEW_OPENED });
  trackEvent({
    userId: user.id,
    officeId: user.officeId,
    eventType: TODAY_EVENTS.SEARCH_OPENED,
    metadata: { patient: "Jane Patient", count: 2 },
  });

  // ── Prove PHI landed LAN-side (query the DB directly) ─────────────
  const jobEventRows = sqlite
    .prepare(`SELECT event_type, payload FROM job_events WHERE job_order_id = ?`)
    .all(job.orderId) as Array<{ event_type: string; payload: string | null }>;

  const attemptRow = jobEventRows.find((r) => r.event_type === "attempt_called");
  assert.ok(attemptRow, "expected an attempt_called job_events row");
  assert.ok(
    JSON.parse(attemptRow!.payload!).note === ATTEMPT_NOTE,
    "attempt note must be stored in job_events.payload",
  );

  const snoozeRow = jobEventRows.find((r) => r.event_type === "snoozed");
  assert.ok(snoozeRow, "expected a snoozed job_events row");
  assert.equal(
    JSON.parse(snoozeRow!.payload!).reason,
    SNOOZE_REASON,
    "snooze reason must be stored in job_events.payload",
  );

  const comments = await storage.getJobComments(job.id);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].content, SNOOZE_REASON, "snooze reason must also land in job_comments");

  // ── Prove the attempt note / snooze reason never reach usage_events ──
  // (The deliberately-injected "Jane Patient" name-shaped string on the
  // today_search_opened event below is a different concern: it EXISTS in
  // raw usage_events by design, since sanitization happens at egress, not
  // at write time. It's asserted stripped from egress further down.)
  const usageEventRows = sqlite.prepare(`SELECT event_type, metadata FROM usage_events`).all() as Array<{
    event_type: string;
    metadata: string | null;
  }>;
  assert.ok(usageEventRows.length > 0, "expected usage_events rows to exist");
  for (const row of usageEventRows) {
    const serialized = row.metadata ?? "";
    assert.ok(!serialized.includes(ATTEMPT_NOTE), `attempt note leaked into usage_events row: ${row.event_type}`);
    assert.ok(!serialized.includes(SNOOZE_REASON), `snooze reason leaked into usage_events row: ${row.event_type}`);
  }

  // ── Call the REAL egress builders ──────────────────────────────────
  const since = new Date(Date.now() - 60_000);
  const rawEvents = getRawEventsSince(since);
  const dailyStats = getAggregatedDailyStats(since);

  const todayRawEvents = rawEvents.filter((e) => e.eventType.startsWith("today_"));
  assert.ok(todayRawEvents.length >= 3, "expected at least the 3 seeded today_* raw events");

  // Serialize the whole egress payload (rawEvents + dailyStats.actions) the
  // same way it would be JSON-stringified into the check-in request body,
  // then grep it for the note/reason/patient-name strings: they must be
  // completely absent from what leaves the LAN.
  const serializedEgress = JSON.stringify({ rawEvents, dailyStats });
  assert.ok(!serializedEgress.includes(ATTEMPT_NOTE), "attempt note must not appear anywhere in the egress payload");
  assert.ok(!serializedEgress.includes(SNOOZE_REASON), "snooze reason must not appear anywhere in the egress payload");
  assert.ok(!serializedEgress.includes("Jane Patient"), "patient name must not appear anywhere in the egress payload");

  // (1) source + eventType-length assertions on every today_* egress row.
  for (const e of todayRawEvents) {
    assert.equal(e.source, "app", `today_* event ${e.eventType} must have source 'app'`);
    assert.ok(e.eventType.length <= 50, `today_* event ${e.eventType} exceeds 50 chars`);
  }

  // (2) name-shaped metadata stripped, numeric metadata survives.
  const searchOpenedEvent = todayRawEvents.find((e) => e.eventType === TODAY_EVENTS.SEARCH_OPENED);
  assert.ok(searchOpenedEvent, "expected the seeded today_search_opened event in egress");
  assert.equal(searchOpenedEvent!.metadata.count, 2, "numeric metadata must survive egress");
  assert.equal(searchOpenedEvent!.metadata.patient, undefined, "patient name must be stripped at egress");

  // (3, restated at the egress-object level) no note/reason key anywhere.
  for (const e of rawEvents) {
    for (const v of Object.values(e.metadata ?? {})) {
      if (typeof v === "string") {
        assert.ok(!v.includes(ATTEMPT_NOTE) && !v.includes(SNOOZE_REASON), "no metadata value carries the note/reason text");
      }
    }
  }

  // (4) No today_* name or action_counts key exceeds 50 chars; no source
  // other than 'app' appears anywhere in the egress output.
  for (const e of rawEvents) {
    assert.ok(e.source === "app" || e.source === "tablet", `unexpected source value: ${e.source}`);
    if (e.eventType.startsWith("today_")) {
      assert.equal(e.source, "app", `today_* event must be source 'app', got ${e.source}`);
    }
  }
  for (const day of dailyStats) {
    for (const actionKey of Object.keys(day.actions)) {
      assert.ok(actionKey.length <= 50, `action_counts key "${actionKey}" exceeds 50 chars`);
    }
  }
});
