import test from "node:test";
import assert from "node:assert/strict";
import { mergeActivity } from "../shared/today-defaults";

test("mergeActivity: filters by type, sorts desc, applies since", () => {
  const items = [
    { id: "comment:1", type: "comment", at: 300, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
    { id: "status:1", type: "status_change", at: 500, jobId: "j", jobLabel: "A", actor: null, verb: "moved" },
    { id: "old:1", type: "comment", at: 50, jobId: "j", jobLabel: "A", actor: null, verb: "commented on" },
  ] as any[];
  const out = mergeActivity(items, 100, ["comment"]);
  assert.deepEqual(out.map((i) => i.id), ["comment:1"]); // status filtered out; old:1 before since
});
