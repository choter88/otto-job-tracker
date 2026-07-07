import test from "node:test";
import assert from "node:assert/strict";
import { mergeActivity, capActivityFeed, ACTIVITY_FEED_CAP } from "../shared/today-defaults";

test("mergeActivity: filters by type, sorts desc, applies since", () => {
  const items = [
    { id: "comment:1", type: "comment", at: 300, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
    { id: "status:1", type: "status_change", at: 500, jobId: "j", jobLabel: "A", actor: null, verb: "moved" },
    { id: "old:1", type: "comment", at: 50, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
  ] as any[];
  const out = mergeActivity(items, 100, ["comment"]);
  assert.deepEqual(out.map((i) => i.id), ["comment:1"]); // status filtered out; old:1 before since
});

// req 8: Team activity feed caps at ~10 with a view-more affordance.
test("capActivityFeed: default limit is 10", () => {
  assert.equal(ACTIVITY_FEED_CAP, 10);
});

test("capActivityFeed: passthrough + hiddenCount 0 when under the limit", () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ id: `${i}` })) as any[];
  const { shown, hiddenCount } = capActivityFeed(items);
  assert.equal(shown.length, 4);
  assert.equal(hiddenCount, 0);
});

test("capActivityFeed: slices to the limit and reports how many are hidden", () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ id: `${i}` })) as any[];
  const { shown, hiddenCount } = capActivityFeed(items);
  assert.equal(shown.length, 10);
  assert.deepEqual(shown.map((i) => i.id), items.slice(0, 10).map((i) => i.id));
  assert.equal(hiddenCount, 13);
});

test("capActivityFeed: exact-limit items produce zero hiddenCount", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `${i}` })) as any[];
  const { shown, hiddenCount } = capActivityFeed(items);
  assert.equal(shown.length, 10);
  assert.equal(hiddenCount, 0);
});

test("capActivityFeed: a custom limit overrides the default", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `${i}` })) as any[];
  const { shown, hiddenCount } = capActivityFeed(items, 3);
  assert.equal(shown.length, 3);
  assert.equal(hiddenCount, 3);
});
