import test from "node:test";
import assert from "node:assert/strict";
import { selectQueueJobs } from "../shared/today-defaults";

const NOW = Date.parse("2026-07-06T12:00:00.000Z");

test("selectQueueJobs: excludes a job snoozed into the future", () => {
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: NOW - 1000, snoozedUntil: NOW + 86400000 },
    { id: "b", status: "ready_for_pickup", statusChangedAt: NOW - 2000, snoozedUntil: null },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], NOW);
  assert.deepEqual(out.map((j) => j.id), ["b"]);
});

test("selectQueueJobs: includes a job whose snooze is null or in the past", () => {
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: NOW - 1000, snoozedUntil: null },
    { id: "b", status: "ready_for_pickup", statusChangedAt: NOW - 2000, snoozedUntil: NOW - 500 },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], NOW);
  assert.deepEqual(out.map((j) => j.id).sort(), ["a", "b"]);
});

test("selectQueueJobs: non-snooze status-filter + sort behavior unchanged", () => {
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: NOW - 1000 },
    { id: "b", status: "ready_for_pickup", statusChangedAt: NOW - 5000 },
    { id: "c", status: "ordered", statusChangedAt: NOW - 9000 },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"], NOW);
  assert.deepEqual(out.map((j) => j.id), ["b", "a"]); // oldest-first, "ordered" excluded
});

test("selectQueueJobs: 2-arg call (no nowMs) still works via default", () => {
  const future = Date.now() + 86400000;
  const jobs = [
    { id: "a", status: "ready_for_pickup", statusChangedAt: Date.now() - 1000, snoozedUntil: future },
    { id: "b", status: "ready_for_pickup", statusChangedAt: Date.now() - 2000 },
  ];
  const out = selectQueueJobs(jobs, ["ready_for_pickup"]);
  assert.deepEqual(out.map((j) => j.id), ["b"]);
});
