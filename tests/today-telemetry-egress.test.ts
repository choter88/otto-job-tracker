/**
 * Today Dashboard v2 telemetry — vocabulary wiring + PHI egress choke point.
 *
 * `getRawEventsSince` builds the payload that leaves the LAN on every
 * license check-in, copying each row's `metadata` verbatim. For `today_*`
 * events specifically, metadata can originate from server-emitted events
 * that (unlike client-emitted Today telemetry, which is numbers-only by
 * type) may carry richer objects upstream — so the egress point itself
 * must strip anything that isn't a number or a short enum token. This
 * test pins that boundary: PHI-shaped values must never survive egress,
 * while non-Today events must pass through completely unchanged.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-today-telemetry-egress-"));
process.env.OTTO_SQLITE_PATH = path.join(TEST_DIR, "today-telemetry-egress.sqlite");

const { sqlite } = await import("../server/db");
const { trackEvent, getRawEventsSince } = await import("../server/usage-tracker");
const { TODAY_EVENTS } = await import("@shared/today-telemetry");

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("all TODAY_EVENTS names are <= 50 chars (unit-level, no DB)", () => {
  for (const name of Object.values(TODAY_EVENTS)) {
    assert.ok(name.length <= 50, `${name} is ${name.length} chars, exceeds 50-char cap`);
  }
});

test("getRawEventsSince strips PHI-shaped metadata from today_* events at egress", () => {
  const since = new Date(Date.now() - 60_000);

  trackEvent({
    userId: "user-1",
    officeId: "office-1",
    eventType: TODAY_EVENTS.SNOOZE,
    metadata: {
      count: 3,
      patient: "Jane Patient",
      note: "call back after the long lunch appointment tomorrow",
    },
  });

  const events = getRawEventsSince(since);
  const todayEvent = events.find((e) => e.eventType === TODAY_EVENTS.SNOOZE);
  assert.ok(todayEvent, "expected the seeded today_snooze event to be present");

  assert.equal(todayEvent!.metadata.count, 3, "numeric metadata must survive egress");
  assert.equal(todayEvent!.metadata.patient, undefined, "patient name must be stripped at egress");
  assert.equal(todayEvent!.metadata.note, undefined, "free-text note must be stripped at egress");
  assert.equal(todayEvent!.source, "app");
  assert.ok(todayEvent!.eventType.length <= 50);
});

test("getRawEventsSince leaves non-today_ event metadata completely untouched", () => {
  const since = new Date(Date.now() - 60_000);

  trackEvent({
    userId: "user-2",
    officeId: "office-1",
    eventType: "job_created",
    metadata: {
      note: "this is a long free-text string that would be stripped if this were a today_ event",
    },
  });

  const events = getRawEventsSince(since);
  const otherEvent = events.find((e) => e.eventType === "job_created");
  assert.ok(otherEvent, "expected the seeded job_created event to be present");
  assert.equal(
    otherEvent!.metadata.note,
    "this is a long free-text string that would be stripped if this were a today_ event",
    "non-today_ event metadata must pass through the egress choke point unchanged",
  );
});
