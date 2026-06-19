import test from "node:test";
import assert from "node:assert/strict";
import { getReconnectDelay, isOnlineLoad } from "../desktop/lib/reconnect.js";

test("getReconnectDelay grows then caps at 15s", () => {
  assert.equal(getReconnectDelay(0), 2000);
  assert.equal(getReconnectDelay(1), 3000);
  assert.equal(getReconnectDelay(2), 4500);
  assert.equal(getReconnectDelay(100), 15000); // capped
});

test("isOnlineLoad is true only for the target app origin", () => {
  assert.equal(isOnlineLoad("https://192.168.1.5:5150/", "https://192.168.1.5:5150"), true);
  assert.equal(isOnlineLoad("https://192.168.1.5:5150/jobs", "https://192.168.1.5:5150/"), true);
  // the local offline page must NOT count as online (or the retry loop would stop)
  assert.equal(isOnlineLoad("file:///Applications/Otto.app/.../offline.html", "https://192.168.1.5:5150"), false);
  assert.equal(isOnlineLoad("https://other:5150/", "https://192.168.1.5:5150"), false);
});

test("isOnlineLoad never throws on garbage", () => {
  assert.equal(isOnlineLoad("", "https://x:5150"), false);
  assert.equal(isOnlineLoad("not a url", "also not"), false);
  assert.equal(isOnlineLoad(null, undefined), false);
});
