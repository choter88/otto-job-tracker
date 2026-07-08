import test from "node:test";
import assert from "node:assert/strict";
import { getNextStatus } from "../shared/job-labels";

// Array order intentionally scrambled vs. the `order` field so the test
// pins that getNextStatus reads `order`, not array position.
const office = {
  settings: {
    customStatuses: [
      { id: "in_progress", label: "Lab Processing", color: "#0284C7", order: 3 },
      { id: "job_created", label: "Created", color: "#2563EB", order: 1 },
      { id: "completed", label: "Dispensed", color: "#059669", order: 7 },
      { id: "ordered", label: "Ordered", color: "#D97706", order: 2 },
      { id: "delayed", label: "Delayed", color: "#EA580C", order: 4 },
      { id: "quality_check", label: "Quality Check", color: "#7C3AED", order: 5 },
      { id: "ready_for_pickup", label: "Ready for Pickup", color: "#16A34A", order: 6 },
    ],
  },
};

test("getNextStatus: returns the status with the next-highest order", () => {
  assert.deepEqual(getNextStatus("ordered", office), { id: "in_progress", label: "Lab Processing" });
});

test("getNextStatus: respects the order field, not array position", () => {
  // "job_created" (order 1) appears after "in_progress" (order 3) in the
  // array, but its next status must still be "ordered" (order 2).
  assert.deepEqual(getNextStatus("job_created", office), { id: "ordered", label: "Ordered" });
});

test("getNextStatus: returns null when already at the last status", () => {
  assert.equal(getNextStatus("completed", office), null);
});

test("getNextStatus: returns null for an unknown status id", () => {
  assert.equal(getNextStatus("bogus", office), null);
});

test("getNextStatus: tolerates missing customStatuses", () => {
  assert.equal(getNextStatus("ordered", {}), null);
  assert.equal(getNextStatus("ordered", undefined), null);
});
