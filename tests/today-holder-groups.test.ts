import test from "node:test";
import assert from "node:assert/strict";
import { groupByHolder } from "../client/src/components/today/today-holder-groups";

const office = {
  settings: {
    customOrderDestinations: [
      { id: "hoya", label: "Hoya", color: "#0284C7", phone: "555-1234" },
      { id: "zeiss", label: "Zeiss", color: "#111111" },
    ],
  },
};

const nowMs = Date.parse("2026-07-06T00:00:00.000Z");
const daysAgo = (n: number) => nowMs - n * 86400000;

function job(overrides: Record<string, any>) {
  return {
    id: overrides.id,
    orderId: overrides.orderId ?? `order-${overrides.id}`,
    status: overrides.status ?? "ordered",
    orderDestination: overrides.orderDestination ?? "hoya",
    statusChangedAt: overrides.statusChangedAt,
    patientFirstName: overrides.patientFirstName ?? "Pat",
    patientLastName: overrides.patientLastName ?? "Ient",
    jobType: overrides.jobType ?? "glasses",
    ...overrides,
  };
}

test("groupByHolder: groups jobs by lab destination and in_office", () => {
  const jobs = [
    job({ id: "a", orderDestination: "hoya", statusChangedAt: daysAgo(10) }),
    job({ id: "b", orderDestination: "zeiss", statusChangedAt: daysAgo(5) }),
    job({ id: "c", status: "job_created", statusChangedAt: daysAgo(3) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  const keys = groups.map((g) => g.key).sort();
  assert.deepEqual(keys, ["hoya", "in_office", "zeiss"]);
});

test("groupByHolder: job_created always groups to in_office regardless of orderDestination", () => {
  const jobs = [
    job({ id: "a", status: "job_created", orderDestination: "hoya", statusChangedAt: daysAgo(1) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "in_office");
  assert.equal(groups[0].kind, "in_office");
  assert.equal(groups[0].label, "In office");
  assert.equal(groups[0].phone, undefined);
  assert.equal(groups[0].destinationId, undefined);
});

test("groupByHolder: lab groups carry the destination's label, phone, and destinationId", () => {
  const jobs = [
    job({ id: "a", orderDestination: "hoya", statusChangedAt: daysAgo(10) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.kind, "lab");
  assert.equal(g.label, "Hoya");
  assert.equal(g.phone, "555-1234");
  assert.equal(g.destinationId, "hoya");
});

test("groupByHolder: lab group with no saved phone has phone undefined", () => {
  const jobs = [
    job({ id: "a", orderDestination: "zeiss", statusChangedAt: daysAgo(2) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.equal(groups[0].phone, undefined);
  assert.equal(groups[0].destinationId, "zeiss");
});

test("groupByHolder: groups ordered by worst row (max days-in-status) descending", () => {
  const jobs = [
    job({ id: "a", orderDestination: "hoya", statusChangedAt: daysAgo(5) }),
    job({ id: "b", orderDestination: "zeiss", statusChangedAt: daysAgo(49) }),
    job({ id: "c", status: "job_created", statusChangedAt: daysAgo(20) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.deepEqual(groups.map((g) => g.key), ["zeiss", "in_office", "hoya"]);
  assert.deepEqual(groups.map((g) => g.worstDays), [49, 20, 5]);
});

test("groupByHolder: rows within a group are sorted worst-first (days-in-status desc)", () => {
  const jobs = [
    job({ id: "a", orderDestination: "hoya", statusChangedAt: daysAgo(3) }),
    job({ id: "b", orderDestination: "hoya", statusChangedAt: daysAgo(30) }),
    job({ id: "c", orderDestination: "hoya", statusChangedAt: daysAgo(15) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].jobs.map((j: any) => j.id), ["b", "c", "a"]);
});

test("groupByHolder: falls back to Title Case label for a destination not in customOrderDestinations", () => {
  const jobs = [
    job({ id: "a", orderDestination: "unknown_lab", statusChangedAt: daysAgo(1) }),
  ];
  const groups = groupByHolder(jobs as any, office, nowMs);
  assert.equal(groups[0].label, "Unknown Lab");
  assert.equal(groups[0].phone, undefined);
  assert.equal(groups[0].destinationId, "unknown_lab");
});

test("groupByHolder: empty jobs list returns empty groups", () => {
  assert.deepEqual(groupByHolder([] as any, office, nowMs), []);
});
