/**
 * Today Dashboard v2 (M4): shared/attempt-summary.ts — pure formatter for the
 * per-row attempt-history summary line ("3 attempts · last text · MK · Jul 3").
 * Separator is " · " (space-middot-space), never an em-dash.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatAttemptSummary } from "../shared/attempt-summary";

test("formatAttemptSummary: plural count, texted -> 'last text', initials, date", () => {
  const lastAt = new Date(2026, 6, 3, 10, 0).getTime(); // Jul 3 2026
  const result = formatAttemptSummary({ count: 3, lastType: "texted", lastActorInitials: "MK", lastAt });
  assert.equal(result, "3 attempts · last text · MK · Jul 3");
});

test("formatAttemptSummary: singular count, called -> 'last call'", () => {
  const lastAt = new Date(2026, 6, 3, 10, 0).getTime();
  const result = formatAttemptSummary({ count: 1, lastType: "called", lastActorInitials: "MK", lastAt });
  assert.equal(result, "1 attempt · last call · MK · Jul 3");
});

test("formatAttemptSummary: null initials omits that segment", () => {
  const lastAt = new Date(2026, 6, 3, 10, 0).getTime();
  const result = formatAttemptSummary({ count: 2, lastType: "called", lastActorInitials: null, lastAt });
  assert.equal(result, "2 attempts · last call · Jul 3");
});

test("formatAttemptSummary: never contains an em-dash", () => {
  const lastAt = new Date(2026, 6, 3, 10, 0).getTime();
  const withInitials = formatAttemptSummary({ count: 5, lastType: "texted", lastActorInitials: "AO", lastAt });
  const withoutInitials = formatAttemptSummary({ count: 5, lastType: "texted", lastActorInitials: null, lastAt });
  assert.ok(!withInitials.includes("—"), "must not contain an em-dash");
  assert.ok(!withoutInitials.includes("—"), "must not contain an em-dash");
});
