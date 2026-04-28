/**
 * Tests for the dynamic LifecycleTrack helpers. The visual component is in
 * client/src/components/lifecycle-track.tsx but the rendering math lives in
 * client/src/lib/lifecycle.ts so it can be unit-tested without the DOM.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackStatuses,
  CANCELLED_STATUS_ID,
  chooseVariant,
  getStepIndex,
  isCancelled,
  MAX_SEGMENTS_BEFORE_METER,
  progressFraction,
} from "../client/src/lib/lifecycle";

const SEVEN_DEFAULT_STATUSES = [
  { id: "job_created", label: "Job Created", order: 1 },
  { id: "ordered", label: "Ordered", order: 2 },
  { id: "in_progress", label: "In Progress", order: 3 },
  { id: "quality_check", label: "Quality Check", order: 4 },
  { id: "ready_for_pickup", label: "Ready for Pickup", order: 5 },
  { id: "completed", label: "Completed", order: 6 },
  { id: "cancelled", label: "Cancelled", order: 7 },
];

test("buildTrackStatuses excludes cancelled and sorts by order", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(track.length, 6);
  assert.equal(track[0].id, "job_created");
  assert.equal(track[track.length - 1].id, "completed");
  assert.ok(track.every((s) => s.id !== CANCELLED_STATUS_ID));
});

test("buildTrackStatuses tolerates statuses without explicit order", () => {
  const track = buildTrackStatuses([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "cancelled", label: "Cancelled" },
  ]);
  assert.equal(track.length, 2);
  assert.equal(track[0].id, "a");
  assert.equal(track[1].id, "b");
});

test("buildTrackStatuses returns empty for invalid input", () => {
  assert.deepEqual(buildTrackStatuses(null as any), []);
  assert.deepEqual(buildTrackStatuses(undefined as any), []);
  assert.deepEqual(buildTrackStatuses([]), []);
});

test("getStepIndex returns correct position", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(getStepIndex(track, "job_created"), 0);
  assert.equal(getStepIndex(track, "in_progress"), 2);
  assert.equal(getStepIndex(track, "completed"), 5);
});

test("getStepIndex returns -1 for cancelled (off-track)", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(getStepIndex(track, CANCELLED_STATUS_ID), -1);
});

test("getStepIndex returns -1 for unknown status", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(getStepIndex(track, "nonexistent"), -1);
});

test("isCancelled detects the terminal cancelled state", () => {
  assert.equal(isCancelled("cancelled"), true);
  assert.equal(isCancelled("ordered"), false);
  assert.equal(isCancelled(""), false);
});

test("chooseVariant: <=8 statuses + ample width → segments", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(chooseVariant(track, 400), "segments");
});

test("chooseVariant: >8 statuses → meter regardless of width", () => {
  const many = Array.from({ length: MAX_SEGMENTS_BEFORE_METER + 2 }, (_, i) => ({
    id: `s${i}`,
    label: `S${i}`,
    order: i + 1,
  }));
  const track = buildTrackStatuses(many);
  assert.equal(chooseVariant(track, 400), "meter");
  assert.equal(chooseVariant(track, 9999), "meter");
});

test("chooseVariant: tight width forces meter even with few statuses", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(chooseVariant(track, 50), "meter");
});

test("chooseVariant: unspecified width defaults to segments when count is OK", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(chooseVariant(track), "segments");
});

test("progressFraction at start is 0, at end is 1", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(progressFraction(track, "job_created"), 0);
  assert.equal(progressFraction(track, "completed"), 1);
});

test("progressFraction in the middle is between 0 and 1", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  const mid = progressFraction(track, "in_progress");
  assert.ok(mid > 0 && mid < 1);
});

test("progressFraction is 0 for cancelled jobs", () => {
  const track = buildTrackStatuses(SEVEN_DEFAULT_STATUSES);
  assert.equal(progressFraction(track, CANCELLED_STATUS_ID), 0);
});

test("progressFraction handles single-status track gracefully", () => {
  const track = buildTrackStatuses([{ id: "only", label: "Only", order: 1 }]);
  assert.equal(progressFraction(track, "only"), 1);
});
