import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultTodayConfig,
  resolveTodayConfig,
  selectQueueJobs,
  boundaryFor,
  ACTIVITY_CATALOG,
} from "../shared/today-defaults";

const VALID = ["job_created", "ordered", "in_progress", "ready_for_pickup", "completed"];

test("defaultTodayConfig: two queue slots + default activity filter", () => {
  const cfg = defaultTodayConfig();
  assert.equal(cfg.slots.length, 2);
  assert.equal(cfg.slots[0].mode, "outreach");
  assert.equal(cfg.slots[1].mode, "chase");
  assert.deepEqual(cfg.activityFilter, ["comment", "overdue", "star_note"]);
});

test("resolveTodayConfig: no prefs → role default", () => {
  const cfg = resolveTodayConfig(undefined, "staff", VALID);
  assert.equal(cfg.slots[0].statusIds?.[0], "ready_for_pickup");
});

test("resolveTodayConfig: filters out unknown status IDs", () => {
  const prefs = { todayConfig: { slots: [
    { type: "queue", mode: "outreach", title: "X", statusIds: ["ready_for_pickup", "gone"] },
    { type: "queue", mode: "chase", title: "Y", statusIds: ["bogus"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.deepEqual(cfg.slots[0].statusIds, ["ready_for_pickup"]);
  // slot 1 had only invalid IDs → falls back to default chase statuses (validated)
  assert.ok(cfg.slots[1].statusIds!.length > 0);
});

test("resolveTodayConfig: staff cannot keep a non-queue tile", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.equal(cfg.slots[0].type, "queue");
});

test("resolveTodayConfig: manager (also privileged) may keep a non-queue tile", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "manager", VALID);
  assert.equal(cfg.slots[0].type, "stats");
});

test("resolveTodayConfig: null/garbage slot entries fall back to role defaults", () => {
  const prefs = { todayConfig: { slots: [null, null], activityFilter: [] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.equal(cfg.slots[0].type, "queue");
  assert.equal(cfg.slots[0].mode, "outreach");
  assert.deepEqual(cfg.activityFilter, ["comment", "overdue", "star_note"]);
});

test("resolveTodayConfig: owner may keep a non-queue tile", () => {
  const prefs = { todayConfig: { slots: [
    { type: "stats" }, { type: "queue", mode: "chase", statusIds: ["ordered"] },
  ], activityFilter: ["comment"] } };
  const cfg = resolveTodayConfig(prefs, "owner", VALID);
  assert.equal(cfg.slots[0].type, "stats");
});

test("resolveTodayConfig: drops unknown activity types, never empty", () => {
  const prefs = { todayConfig: { slots: defaultTodayConfig().slots, activityFilter: ["bogus"] } };
  const cfg = resolveTodayConfig(prefs, "staff", VALID);
  assert.deepEqual(cfg.activityFilter, ["comment", "overdue", "star_note"]);
});

test("selectQueueJobs: filters by status, sorts oldest-first", () => {
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: 300 },
    { id: "b", status: "completed", statusChangedAt: 100 },
    { id: "c", status: "ready_for_pickup", statusChangedAt: 100 },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"]);
  assert.deepEqual(out.map((j) => j.id), ["c", "a"]);
});

test("boundaryFor: uses lastSignout when present, else now-24h", () => {
  assert.equal(boundaryFor(5000, 9000), 5000);
  assert.equal(boundaryFor(null, 9000), 9000 - 24 * 60 * 60 * 1000);
  assert.equal(boundaryFor(0, 9000), 9000 - 24 * 60 * 60 * 1000);
});

test("ACTIVITY_CATALOG has the four agreed types", () => {
  assert.deepEqual(ACTIVITY_CATALOG.map((a) => a.type),
    ["comment", "status_change", "overdue", "star_note"]);
});
