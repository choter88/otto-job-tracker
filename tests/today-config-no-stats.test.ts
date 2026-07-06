/**
 * M2: the owner "stats strip" (StatsTile / office snapshot) is cut from the
 * Today screen. resolveTodayConfig must never hand back a "stats" or
 * "analytics" slot — not from the role defaults, and not from a stored
 * preferences.todayConfig that still has one persisted from before the cut
 * (existing owners shouldn't get it back just because it's saved).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolveTodayConfig, defaultTodayConfig } from "../shared/today-defaults";

const VALID = ["job_created", "ordered", "in_progress", "ready_for_pickup", "completed", "delayed"];

test("resolveTodayConfig: owner default config has no stats/analytics slot", () => {
  const cfg = resolveTodayConfig(undefined, "owner", VALID);
  for (const slot of cfg.slots) {
    assert.notEqual(slot.type, "stats");
    assert.notEqual(slot.type, "analytics");
  }
});

test("resolveTodayConfig: a persisted 'stats' slot is coerced away for owner", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "owner", VALID);
  assert.notEqual(cfg.slots[0].type, "stats");
  assert.notEqual(cfg.slots[0].type, "analytics");
  assert.equal(cfg.slots[0].type, "queue");
});

test("resolveTodayConfig: a persisted 'analytics' slot is coerced away for manager", () => {
  const prefs = { todayConfig: { slots: [
    { type: "analytics" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "manager", VALID);
  assert.notEqual(cfg.slots[0].type, "stats");
  assert.notEqual(cfg.slots[0].type, "analytics");
  assert.equal(cfg.slots[0].type, "queue");
});

test("resolveTodayConfig: 'team' slot is still allowed for a privileged role (not cut)", () => {
  const prefs = { todayConfig: { slots: [
    { type: "team" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "owner", VALID);
  assert.equal(cfg.slots[0].type, "team");
});

test("resolveTodayConfig: queue slots (outreach/chase) are unaffected by the stats cut", () => {
  const cfg = resolveTodayConfig(undefined, "owner", VALID);
  const defaults = defaultTodayConfig();
  assert.equal(cfg.slots[0].type, "queue");
  assert.equal(cfg.slots[0].mode, "outreach");
  assert.deepEqual(cfg.slots[0].statusIds, defaults.slots[0].statusIds);
  assert.equal(cfg.slots[1].type, "queue");
  assert.equal(cfg.slots[1].mode, "chase");
  assert.deepEqual(cfg.slots[1].statusIds, defaults.slots[1].statusIds);
});
