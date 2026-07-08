import test from "node:test";
import assert from "node:assert/strict";
import { statusFromSearch } from "../shared/status-from-search";

test("statusFromSearch: reads the status param", () => {
  assert.equal(statusFromSearch("?status=ready_for_pickup"), "ready_for_pickup");
});

test("statusFromSearch: works without a leading '?'", () => {
  assert.equal(statusFromSearch("status=ready_for_pickup"), "ready_for_pickup");
});

test("statusFromSearch: returns null when the param is missing", () => {
  assert.equal(statusFromSearch("?other=1"), null);
});

test("statusFromSearch: returns null for an empty search string", () => {
  assert.equal(statusFromSearch(""), null);
});

test("statusFromSearch: returns null for an empty status value", () => {
  assert.equal(statusFromSearch("?status="), null);
});
