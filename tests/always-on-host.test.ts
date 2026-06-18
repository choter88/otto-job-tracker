/**
 * Guard for the always-on-host gate (Workstream A of the LAN-first plan).
 *
 * The whole point of the gate is that always-on is DARK-SHIPPED: with the
 * OTTO_ALWAYS_ON_HOST capability unset (the production default) every always-on
 * code path must be inert, so the packaged app behaves byte-for-byte as before
 * (quit-on-close, no login item, no tray). This test pins that truth table so a
 * future edit can't accidentally turn the feature on in production.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isAlwaysOnHostCapable, isAlwaysOnHostActive } from "../desktop/lib/always-on.js";

const ON = { OTTO_ALWAYS_ON_HOST: "true" };
const OFF = {};

test("capability requires OTTO_ALWAYS_ON_HOST === 'true' exactly", () => {
  assert.equal(isAlwaysOnHostCapable(ON), true);
  assert.equal(isAlwaysOnHostCapable(OFF), false);
  assert.equal(isAlwaysOnHostCapable({ OTTO_ALWAYS_ON_HOST: "1" }), false);
  assert.equal(isAlwaysOnHostCapable({ OTTO_ALWAYS_ON_HOST: "TRUE" }), false);
  assert.equal(isAlwaysOnHostCapable({ OTTO_ALWAYS_ON_HOST: "" }), false);
});

test("production (capability off) is always inert, regardless of config", () => {
  assert.equal(isAlwaysOnHostActive({ mode: "host" }, OFF), false);
  assert.equal(isAlwaysOnHostActive({ mode: "host", alwaysOnHost: true }, OFF), false);
  assert.equal(isAlwaysOnHostActive({ mode: "client" }, OFF), false);
});

test("when capable, a Host is active by default and opt-out wins", () => {
  // Default-on once capable: no alwaysOnHost field means active.
  assert.equal(isAlwaysOnHostActive({ mode: "host" }, ON), true);
  assert.equal(isAlwaysOnHostActive({ mode: "host", alwaysOnHost: true }, ON), true);
  // Explicit opt-out for this machine.
  assert.equal(isAlwaysOnHostActive({ mode: "host", alwaysOnHost: false }, ON), false);
});

test("always-on never applies to a Client (no server to keep alive)", () => {
  assert.equal(isAlwaysOnHostActive({ mode: "client" }, ON), false);
  assert.equal(isAlwaysOnHostActive({ mode: "client", alwaysOnHost: true }, ON), false);
});

test("missing/odd config never throws and is treated as inactive", () => {
  assert.equal(isAlwaysOnHostActive(undefined, ON), false);
  assert.equal(isAlwaysOnHostActive(null, ON), false);
  assert.equal(isAlwaysOnHostActive({}, ON), false);
  assert.equal(isAlwaysOnHostActive({ mode: "host" }, undefined), false);
});
