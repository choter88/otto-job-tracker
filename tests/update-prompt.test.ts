/**
 * Tests for the update-install prompt copy + safe defaults (Phase 2).
 *
 * The behavior that matters: when remote workstations are connected, the
 * install dialog must warn that the office goes briefly offline AND default to
 * the non-destructive button ("Later"), so an always-on Host isn't restarted
 * out from under connected workstations by a stray Enter press.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildUpdateInstallPrompt } from "../desktop/lib/update-prompt.js";

test("no clients: simple copy, defaults to Install", () => {
  const p = buildUpdateInstallPrompt(0, "1.2.3");
  assert.equal(p.message, "Install version 1.2.3?");
  assert.match(p.detail, /install the update, and reopen/i);
  assert.doesNotMatch(p.detail, /workstation/i);
  assert.equal(p.defaultId, 0); // "Install & Restart"
  assert.equal(p.cancelId, 1);
});

test("clients connected: warns about going offline and defaults to Later", () => {
  const p = buildUpdateInstallPrompt(3, "1.2.3");
  assert.match(p.detail, /3 workstations are connected/);
  assert.match(p.detail, /offline/i);
  assert.equal(p.defaultId, 1); // "Later" — the safe choice
  assert.equal(p.cancelId, 1);
});

test("one client: singular grammar", () => {
  const p = buildUpdateInstallPrompt(1, "9.9.9");
  assert.match(p.detail, /1 workstation is connected/);
});

test("missing/odd inputs never throw and read as no-clients", () => {
  assert.equal(buildUpdateInstallPrompt(undefined, undefined).defaultId, 0);
  assert.equal(buildUpdateInstallPrompt(-1, "1.0.0").defaultId, 0);
  assert.equal(buildUpdateInstallPrompt(NaN, "1.0.0").defaultId, 0);
  // Version omitted → generic message, still valid.
  assert.equal(buildUpdateInstallPrompt(0, null).message, "Install the update?");
});
