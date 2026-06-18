/**
 * Packaging guard for the always-on-host feature (Workstream A).
 *
 * The new code (desktop/lib/always-on.js) and the tray icon
 * (desktop/assets/tray-icon.png) only reach users if they ship inside the asar.
 * They ride the existing `desktop/**` glob "for free" — this test pins that the
 * glob (and the better-sqlite3 asarUnpack) is still in build.files so a future
 * edit to package.json can't silently drop them, and confirms the assets exist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));

test("build.files still ships desktop/** so new always-on files are packaged", () => {
  const files: string[] = pkg.build?.files ?? [];
  assert.ok(files.includes("desktop/**"), "build.files must include 'desktop/**'");
});

test("better-sqlite3 stays asarUnpack'd (embedded server unchanged)", () => {
  const unpack: string[] = pkg.build?.asarUnpack ?? [];
  assert.ok(
    unpack.some((p) => p.includes("better-sqlite3")),
    "asarUnpack must still list better-sqlite3",
  );
});

test("always-on module and tray icon asset exist", () => {
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, "desktop/lib/always-on.js")),
    "desktop/lib/always-on.js must exist",
  );
  const trayIcon = path.join(REPO_ROOT, "desktop/assets/tray-icon.png");
  assert.ok(fs.existsSync(trayIcon), "desktop/assets/tray-icon.png must exist");
  assert.ok(fs.statSync(trayIcon).size > 0, "tray icon must not be empty");
});
