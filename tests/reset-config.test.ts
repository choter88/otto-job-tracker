/**
 * Resetting a Host must return it to the SETUP wizard on next boot — not the
 * client "Can't reach the office server" screen.
 *
 * The bug: _resetHost() cleared mode/host-identity but left setupComplete=true,
 * so boot read the config as "complete", skipped setup, and the now-empty mode
 * routed getTargetUrlForConfig() to the stale hostUrl → the client offline page.
 *
 * buildResetConfig() must produce a config that setupState() classifies as
 * "incomplete" (forces the setup wizard) while preserving backup settings.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildResetConfig, setupState, getDefaultConfig } from "../desktop/lib/config.js";

test("reset config reads back as incomplete so boot re-runs setup (not the offline screen)", () => {
  const hostConfig = {
    ...getDefaultConfig(),
    mode: "host",
    hostToken: "tok-123",
    activationCode: "ABC123",
    trustedFingerprint256: "ff:ee:dd",
    setupComplete: true,
  };
  assert.equal(setupState(buildResetConfig(hostConfig)), "incomplete");
});

test("reset clears all host identity", () => {
  const reset = buildResetConfig({
    mode: "host",
    hostToken: "t",
    activationCode: "a",
    trustedFingerprint256: "f",
    setupComplete: true,
  });
  assert.equal(reset.mode, "");
  assert.equal(reset.hostToken, "");
  assert.equal(reset.activationCode, "");
  assert.equal(reset.trustedFingerprint256, "");
});

test("reset preserves backup settings (the reset dialog promises local backups survive)", () => {
  const reset = buildResetConfig({
    ...getDefaultConfig(),
    mode: "host",
    setupComplete: true,
    backupDir: "/Volumes/share/otto",
    backupRetention: 30,
    localBackupRetention: 10,
  });
  assert.equal(reset.backupDir, "/Volumes/share/otto");
  assert.equal(reset.backupRetention, 30);
  assert.equal(reset.localBackupRetention, 10);
});
