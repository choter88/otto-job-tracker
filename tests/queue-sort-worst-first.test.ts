import test from "node:test";
import assert from "node:assert/strict";
import { selectQueueJobs } from "../shared/today-defaults";

const nowMs = Date.parse("2026-07-06T00:00:00.000Z");
const daysAgo = (n: number) => nowMs - n * 86400000;

function job(overrides: Record<string, any>) {
  return {
    id: overrides.id,
    status: overrides.status ?? "ready_for_pickup",
    statusChangedAt: overrides.statusChangedAt,
    snoozedUntil: overrides.snoozedUntil ?? null,
  };
}

test("selectQueueJobs: worst-first — oldest statusChangedAt (longest in status) sorts first", () => {
  const jobs = [
    job({ id: "newest", statusChangedAt: daysAgo(1) }),
    job({ id: "oldest", statusChangedAt: daysAgo(30) }),
    job({ id: "middle", statusChangedAt: daysAgo(10) }),
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], nowMs);
  assert.deepEqual(out.map((j) => j.id), ["oldest", "middle", "newest"]);
});

test("selectQueueJobs: worst-first ordering holds across many jobs, not just a 3-item case", () => {
  const jobs = [
    job({ id: "a", statusChangedAt: daysAgo(2) }),
    job({ id: "b", statusChangedAt: daysAgo(45) }),
    job({ id: "c", statusChangedAt: daysAgo(0.5) }),
    job({ id: "d", statusChangedAt: daysAgo(15) }),
    job({ id: "e", statusChangedAt: daysAgo(7) }),
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], nowMs);
  assert.deepEqual(out.map((j) => j.id), ["b", "d", "e", "a", "c"]);
});

test("selectQueueJobs: worst-first ordering is preserved after filtering out other statuses and future-snoozed jobs", () => {
  const jobs = [
    job({ id: "keep-old", status: "ready_for_pickup", statusChangedAt: daysAgo(20) }),
    job({ id: "other-status", status: "in_progress", statusChangedAt: daysAgo(50) }),
    job({ id: "keep-new", status: "ready_for_pickup", statusChangedAt: daysAgo(3) }),
    job({ id: "snoozed-future", status: "ready_for_pickup", statusChangedAt: daysAgo(100), snoozedUntil: daysAgo(-5) }),
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], nowMs);
  assert.deepEqual(out.map((j) => j.id), ["keep-old", "keep-new"]);
});
