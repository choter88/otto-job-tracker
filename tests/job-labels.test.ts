import test from "node:test";
import assert from "node:assert/strict";
import {
  getJobTypeLabel,
  getDestination,
  getDestinationLabel,
  formatDaysInStatus,
} from "../shared/job-labels";

const officeNoCustomTypes = { settings: { customJobTypes: [], customOrderDestinations: [] } };

const officeWithCustom = {
  settings: {
    customJobTypes: [{ id: "exam_frames", label: "Exam + Frames", color: "#000", order: 1 }],
    customOrderDestinations: [
      { id: "hoya", label: "Hoya", color: "#0284C7", order: 1, phone: "555-1234" },
    ],
  },
};

test("getJobTypeLabel: falls back to Title Case when no custom type matches", () => {
  assert.equal(getJobTypeLabel("exam_frames", officeNoCustomTypes), "Exam Frames");
});

test("getJobTypeLabel: falls back to Title Case for kebab/space separated ids", () => {
  assert.equal(getJobTypeLabel("exam-frames", officeNoCustomTypes), "Exam Frames");
  assert.equal(getJobTypeLabel("exam frames", officeNoCustomTypes), "Exam Frames");
});

test("getJobTypeLabel: uses custom type label when present", () => {
  assert.equal(getJobTypeLabel("exam_frames", officeWithCustom), "Exam + Frames");
});

test("getJobTypeLabel: tolerates missing settings/office", () => {
  assert.equal(getJobTypeLabel("glasses", undefined), "Glasses");
  assert.equal(getJobTypeLabel("glasses", {}), "Glasses");
});

test("getDestination: returns the matching destination object", () => {
  assert.deepEqual(getDestination("hoya", officeWithCustom), {
    id: "hoya",
    label: "Hoya",
    color: "#0284C7",
    order: 1,
    phone: "555-1234",
  });
});

test("getDestination: returns undefined when no match", () => {
  assert.equal(getDestination("hoya", officeNoCustomTypes), undefined);
});

test("getDestinationLabel: falls back to Title Case when no custom destination matches", () => {
  assert.equal(getDestinationLabel("zeiss", officeNoCustomTypes), "Zeiss");
});

test("getDestinationLabel: uses custom destination label when present", () => {
  assert.equal(getDestinationLabel("hoya", officeWithCustom), "Hoya");
});

test("formatDaysInStatus: computes whole days elapsed from a fixed nowMs", () => {
  const nowMs = Date.parse("2026-07-06T00:00:00.000Z");
  const statusChangedAt = nowMs - 49 * 86400000;
  assert.equal(formatDaysInStatus(statusChangedAt, nowMs), 49);
  assert.equal(formatDaysInStatus(new Date(statusChangedAt), nowMs), 49);
});

test("formatDaysInStatus: same-day is 0", () => {
  const nowMs = Date.parse("2026-07-06T12:00:00.000Z");
  const statusChangedAt = Date.parse("2026-07-06T01:00:00.000Z");
  assert.equal(formatDaysInStatus(statusChangedAt, nowMs), 0);
});
