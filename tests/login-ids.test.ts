import test from "node:test";
import assert from "node:assert/strict";
import { toLoginIds } from "../server/login-ids.ts";

test("toLoginIds returns only login IDs, deduped and sorted", () => {
  const users = [
    { loginId: "zoe", firstName: "Zoe", pinHash: "secret" },
    { loginId: "amy", firstName: "Amy", pinHash: "secret" },
    { loginId: "amy", firstName: "Amy2" },
  ];
  assert.deepEqual(toLoginIds(users), ["amy", "zoe"]);
});

test("toLoginIds drops empty/missing and never leaks other fields", () => {
  const out = toLoginIds([{ loginId: "" }, { loginId: null }, {}, { loginId: "bob" }]);
  assert.deepEqual(out, ["bob"]);
  assert.equal(out.every((v) => typeof v === "string"), true);
});

test("toLoginIds tolerates bad input", () => {
  assert.deepEqual(toLoginIds(undefined), []);
  assert.deepEqual(toLoginIds(null), []);
  assert.deepEqual(toLoginIds([]), []);
});
