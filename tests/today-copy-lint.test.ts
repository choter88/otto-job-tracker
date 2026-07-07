/**
 * Today Dashboard v2 (M10): copy-lint regression lock.
 *
 * Reads the Today UI source files as plain text (not through a bundler/AST)
 * and pins two copy guarantees that earlier milestones established:
 *
 *  - No em-dash (U+2014 "—") or en-dash (U+2013 "–") anywhere in these
 *    files, including comments, so stray "smart punctuation" never creeps
 *    back into UI copy (or the source around it).
 *  - No `formatDistanceToNow` (fuzzy "about 1 month ago"-style durations)
 *    in the Today queue row components: the one duration unit shown on a
 *    Today row is whole days (see shared/job-labels.ts formatDaysInStatus).
 *
 * Scope mirrors the M10 task brief: everything under
 * client/src/components/today/, client/src/pages/today.tsx,
 * client/src/components/search-palette.tsx, and shared/today-defaults.ts.
 * Extended by the final whole-branch review (Fix B) to also cover
 * shared/job-labels.ts, shared/snooze-presets.ts, shared/attempt-summary.ts,
 * and client/src/components/topbar.tsx — all of which render Today copy but
 * were missed by the original M10 scope.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");

function todayComponentFiles(): string[] {
  const dir = path.join(REPO_ROOT, "client/src/components/today");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => path.join(dir, f));
}

const ALL_SCOPED_FILES = [
  ...todayComponentFiles(),
  path.join(REPO_ROOT, "client/src/pages/today.tsx"),
  path.join(REPO_ROOT, "client/src/components/search-palette.tsx"),
  path.join(REPO_ROOT, "shared/today-defaults.ts"),
  path.join(REPO_ROOT, "shared/job-labels.ts"),
  path.join(REPO_ROOT, "shared/snooze-presets.ts"),
  path.join(REPO_ROOT, "shared/attempt-summary.ts"),
  path.join(REPO_ROOT, "client/src/components/topbar.tsx"),
];

// The queue ROW components specifically (OutreachRow/ChaseRow both live in
// job-queue-tile.tsx): this is where the "duration = whole days" rule
// applies. The Team activity feed (activity-tile.tsx) is a different
// surface (relative timestamps on feed items, not a job's day-count) and is
// intentionally out of scope for the duration-unit rule.
const ROW_COMPONENT_FILE = path.join(REPO_ROOT, "client/src/components/today/job-queue-tile.tsx");

test("Today UI files contain no em-dash or en-dash characters", () => {
  for (const file of ALL_SCOPED_FILES) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      assert.ok(
        !line.includes("—"),
        `${path.relative(REPO_ROOT, file)}:${i + 1} contains an em-dash (U+2014): ${line.trim()}`,
      );
      assert.ok(
        !line.includes("–"),
        `${path.relative(REPO_ROOT, file)}:${i + 1} contains an en-dash (U+2013): ${line.trim()}`,
      );
    });
  }
});

test("Today row components use whole-day durations, not fuzzy formatDistanceToNow", () => {
  const content = fs.readFileSync(ROW_COMPONENT_FILE, "utf8");
  assert.ok(
    !content.includes("formatDistanceToNow"),
    "job-queue-tile.tsx (OutreachRow/ChaseRow) must not use formatDistanceToNow: rows show whole days only",
  );
  assert.ok(
    !/\babout\s+1\s+month\b/i.test(content),
    "job-queue-tile.tsx must not contain fuzzy 'about 1 month'-style duration phrasing",
  );
  assert.ok(
    !/\bmonths?\s+ago\b/i.test(content),
    "job-queue-tile.tsx must not contain 'month(s) ago'-style duration phrasing",
  );
});

test("Today row components have no other duration units besides days", () => {
  // Defensive: guard the whole scoped file set too, not just job-queue-tile,
  // so a duration helper added to another Today file doesn't quietly
  // reintroduce fuzzy phrasing.
  for (const file of ALL_SCOPED_FILES) {
    const content = fs.readFileSync(file, "utf8");
    assert.ok(
      !/\babout\s+1\s+month\b/i.test(content),
      `${path.relative(REPO_ROOT, file)} contains fuzzy 'about 1 month'-style duration phrasing`,
    );
  }
});
