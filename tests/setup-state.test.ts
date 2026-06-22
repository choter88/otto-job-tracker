/**
 * Guards the first-run gate. The app used to decide "show setup vs. app" by
 * whether a config FILE existed — but setup writes that file mid-flow (it starts
 * the host server before the office is bootstrapped). So abandoning setup left a
 * half-host config and the app booted into "backup folder" + "Office setup
 * needed" instead of re-opening setup. setupState() is the three-way classifier
 * that fixes it; this pins its truth table.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { setupState, getDefaultConfig } from "../desktop/lib/config.js";

test("explicit flag maps to complete / incomplete", () => {
  assert.equal(setupState({ setupComplete: true }), "complete");
  assert.equal(setupState({ setupComplete: false }), "incomplete");
});

test("missing flag is legacy (pre-flag install — assume done)", () => {
  assert.equal(setupState({ mode: "host" }), "legacy");
  assert.equal(setupState({}), "legacy");
  assert.equal(setupState(null), "legacy");
});

test("default config has no flag, so a fresh merge stays legacy until stamped", () => {
  // getDefaultConfig() must NOT carry setupComplete, or readConfig() would
  // fabricate it for legacy files and break the migration path.
  assert.equal("setupComplete" in getDefaultConfig(), false);
  assert.equal(setupState(getDefaultConfig()), "legacy");
});

test("an abandoned mid-setup save reads back as incomplete", () => {
  // Simulates otto:config:set's partial write merged over defaults.
  const partial = { ...getDefaultConfig(), mode: "host", setupComplete: false };
  assert.equal(setupState(partial), "incomplete");
});
