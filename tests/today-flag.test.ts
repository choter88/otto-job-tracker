import test from "node:test";
import assert from "node:assert/strict";
import { isTodayV2Enabled } from "../shared/today-flag";
import { TODAY_EVENTS } from "../shared/today-telemetry";

test("isTodayV2Enabled: default off", () => {
  delete process.env.OTTO_TODAY_V2;
  assert.equal(isTodayV2Enabled(), false);
  assert.equal(isTodayV2Enabled({}), false);
  assert.equal(isTodayV2Enabled({ settings: {} }), false);
});

test("isTodayV2Enabled: env OTTO_TODAY_V2 truthy turns it on", () => {
  process.env.OTTO_TODAY_V2 = "1";
  assert.equal(isTodayV2Enabled(), true);
  process.env.OTTO_TODAY_V2 = "true";
  assert.equal(isTodayV2Enabled(), true);
  delete process.env.OTTO_TODAY_V2;
});

test("isTodayV2Enabled: env falsy values stay off", () => {
  process.env.OTTO_TODAY_V2 = "0";
  assert.equal(isTodayV2Enabled(), false);
  process.env.OTTO_TODAY_V2 = "false";
  assert.equal(isTodayV2Enabled(), false);
  delete process.env.OTTO_TODAY_V2;
});

test("isTodayV2Enabled: office.settings.todayV2 === true turns it on", () => {
  delete process.env.OTTO_TODAY_V2;
  assert.equal(isTodayV2Enabled({ settings: { todayV2: true } }), true);
  assert.equal(isTodayV2Enabled({ settings: { todayV2: false } }), false);
});

test("TODAY_EVENTS: all values are snake_case and <= 50 chars", () => {
  for (const value of Object.values(TODAY_EVENTS)) {
    assert.ok(value.length <= 50, `${value} exceeds 50 chars`);
    assert.match(value, /^[a-z0-9_]+$/, `${value} is not snake_case`);
  }
});
