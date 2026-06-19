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

import { isAlwaysOnHostCapable, isAlwaysOnHostActive, shouldStartHostServer, isResidentApp, residentToggleField, residentCopy } from "../desktop/lib/always-on.js";

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

// shouldStartHostServer decides whether launchMainWindowForConfig must run the
// host bring-up (port pre-flight + start + readiness wait). The whole point is
// that a REOPEN — when the embedded server is already running in this process —
// must NOT re-run the port pre-flight, or it collides with our own server and
// shows a spurious "port in use" error that traps the user behind a window that
// won't reopen. It is deliberately independent of the always-on capability: a
// plain Host that isn't always-on still must not double-start its server.
test("host brings the server up on a fresh launch, never on reopen", () => {
  // Fresh launch: server not yet started → bring it up.
  assert.equal(shouldStartHostServer({ mode: "host" }, false), true);
  // Reopen: server already running in this process → skip the bring-up so the
  // port pre-flight can't collide with our own server.
  assert.equal(shouldStartHostServer({ mode: "host" }, true), false);
});

test("a Client never starts a host server (it has none)", () => {
  assert.equal(shouldStartHostServer({ mode: "client" }, false), false);
  assert.equal(shouldStartHostServer({ mode: "client" }, true), false);
});

test("shouldStartHostServer tolerates missing/odd config without throwing", () => {
  assert.equal(shouldStartHostServer(undefined, false), false);
  assert.equal(shouldStartHostServer(null, false), false);
  assert.equal(shouldStartHostServer({}, false), false);
});

test("isResidentApp: capability off is always inert", () => {
  assert.equal(isResidentApp({ mode: "host" }, OFF), false);
  assert.equal(isResidentApp({ mode: "client" }, OFF), false);
});

test("isResidentApp: host mirrors always-on (default-on, opt-out wins)", () => {
  assert.equal(isResidentApp({ mode: "host" }, ON), true);
  assert.equal(isResidentApp({ mode: "host", alwaysOnHost: true }, ON), true);
  assert.equal(isResidentApp({ mode: "host", alwaysOnHost: false }, ON), false);
});

test("isResidentApp: client is default-on once capable, opt-out wins", () => {
  assert.equal(isResidentApp({ mode: "client" }, ON), true);
  assert.equal(isResidentApp({ mode: "client", keepClientResident: true }, ON), true);
  assert.equal(isResidentApp({ mode: "client", keepClientResident: false }, ON), false);
});

test("isResidentApp: missing/odd config never throws", () => {
  assert.equal(isResidentApp(undefined, ON), false);
  assert.equal(isResidentApp(null, ON), false);
  assert.equal(isResidentApp({}, ON), false);
  assert.equal(isResidentApp({ mode: "weird" }, ON), false);
});

test("residentToggleField selects the per-mode opt-out field", () => {
  assert.equal(residentToggleField("host"), "alwaysOnHost");
  assert.equal(residentToggleField("client"), "keepClientResident");
});

test("residentCopy: host keeps server-centric copy + workstation count", () => {
  const c = residentCopy("host");
  assert.equal(c.showWorkstationCount, true);
  assert.equal(c.trayTooltip, "Otto Tracker — office server");
  assert.match(c.trayStatusLabel, /server is running/);
  assert.match(c.trayQuitLabel, /take office offline/);
  assert.match(c.hiddenNoticeBody, /Workstations stay connected/);
});

test("residentCopy: client uses connection copy, no server/count language", () => {
  const c = residentCopy("client");
  assert.equal(c.showWorkstationCount, false);
  assert.equal(c.trayTooltip, "Otto Tracker");
  assert.equal(c.trayQuitLabel, "Quit Otto");
  assert.doesNotMatch(c.trayStatusLabel, /server/i);
  assert.doesNotMatch(c.hiddenNoticeBody, /Workstations stay connected/);
});
