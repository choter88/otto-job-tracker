import test from "node:test";
import assert from "node:assert/strict";
import { parseHostPort } from "../desktop/lib/host-probe.js";

test("parseHostPort extracts host + explicit port", () => {
  assert.deepEqual(parseHostPort("https://192.168.1.5:5150"), { host: "192.168.1.5", port: 5150 });
  assert.deepEqual(parseHostPort("https://192.168.1.5:5150/jobs?x=1"), { host: "192.168.1.5", port: 5150 });
});

test("parseHostPort defaults the port by scheme", () => {
  assert.deepEqual(parseHostPort("https://host.local"), { host: "host.local", port: 443 });
  assert.deepEqual(parseHostPort("http://host.local"), { host: "host.local", port: 80 });
});

test("parseHostPort returns null on garbage", () => {
  assert.equal(parseHostPort("not a url"), null);
  assert.equal(parseHostPort(""), null);
  assert.equal(parseHostPort(null), null);
  assert.equal(parseHostPort(undefined), null);
});
