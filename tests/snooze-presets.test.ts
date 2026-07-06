import test from "node:test";
import assert from "node:assert/strict";
import { snoozeUntilMs, SNOOZE_PRESET_LABELS } from "../shared/snooze-presets";

// Fixed local-time fixtures. Constructed via `new Date(year, monthIndex, day, hour, minute)`
// so the assertions are local-time based, matching the function's contract.

test("tomorrow: next calendar day at 08:00 local", () => {
  const now = new Date(2026, 6, 8, 14, 0).getTime(); // Wed Jul 8 2026, 2:00pm
  const expected = new Date(2026, 6, 9, 8, 0).getTime(); // Thu Jul 9 2026, 8:00am
  assert.equal(snoozeUntilMs("tomorrow", now), expected);
});

test("tomorrow: crosses a month boundary (Jan 31 -> Feb 1)", () => {
  const now = new Date(2026, 0, 31, 14, 0).getTime(); // Sat Jan 31 2026, 2:00pm
  const expected = new Date(2026, 1, 1, 8, 0).getTime(); // Sun Feb 1 2026, 8:00am
  assert.equal(snoozeUntilMs("tomorrow", now), expected);
});

test("friday: from a Wednesday resolves to that week's Friday at 08:00 local", () => {
  const now = new Date(2026, 6, 8, 14, 0).getTime(); // Wed Jul 8 2026, 2:00pm
  const expected = new Date(2026, 6, 10, 8, 0).getTime(); // Fri Jul 10 2026, 8:00am
  assert.equal(snoozeUntilMs("friday", now), expected);
});

test("friday: on a Friday before 08:00 resolves to today at 08:00 local", () => {
  const now = new Date(2026, 6, 10, 6, 30).getTime(); // Fri Jul 10 2026, 6:30am
  const expected = new Date(2026, 6, 10, 8, 0).getTime(); // same day, 8:00am
  assert.equal(snoozeUntilMs("friday", now), expected);
});

test("friday: on a Friday after 08:00 resolves to next Friday at 08:00 local", () => {
  const now = new Date(2026, 6, 10, 9, 0).getTime(); // Fri Jul 10 2026, 9:00am
  const expected = new Date(2026, 6, 17, 8, 0).getTime(); // Fri Jul 17 2026, 8:00am
  assert.equal(snoozeUntilMs("friday", now), expected);
});

test("next_week: resolves to Monday of next week at 08:00 local", () => {
  const now = new Date(2026, 6, 8, 14, 0).getTime(); // Wed Jul 8 2026, 2:00pm
  const expected = new Date(2026, 6, 13, 8, 0).getTime(); // Mon Jul 13 2026, 8:00am
  assert.equal(snoozeUntilMs("next_week", now), expected);
});

test("next_week: from a Monday still resolves to the following Monday, not today", () => {
  const now = new Date(2026, 6, 13, 9, 0).getTime(); // Mon Jul 13 2026, 9:00am
  const expected = new Date(2026, 6, 20, 8, 0).getTime(); // Mon Jul 20 2026, 8:00am
  assert.equal(snoozeUntilMs("next_week", now), expected);
});

test("SNOOZE_PRESET_LABELS has the three presets with plain, present-tense labels", () => {
  assert.deepEqual(SNOOZE_PRESET_LABELS, {
    tomorrow: "Tomorrow",
    friday: "This Friday",
    next_week: "Next week",
  });
});
