/**
 * Pure decision logic for the portal-login onboarding flow (no Electron, no
 * network). decidePreselectedRole: "first computer => host", "host already
 * serving => client", "stale/ambiguous => manual (fail closed)".
 * pickReachableHostUrl: probe the portal's published addresses, take the first
 * that answers. addressToUrl: scheme-less "host:port" -> full URL (WAF strips
 * schemes on the wire, so we re-add it here).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  addressToUrl,
  decidePreselectedRole,
  pickReachableHostUrl,
} from "../desktop/lib/onboarding-role.js";

test("addressToUrl adds the scheme to a scheme-less host:port", () => {
  assert.equal(addressToUrl("192.168.1.5:5150"), "https://192.168.1.5:5150");
  assert.equal(addressToUrl("host.lan:5150", "http"), "http://host.lan:5150");
});

test("addressToUrl returns null on garbage", () => {
  assert.equal(addressToUrl(""), null);
  assert.equal(addressToUrl(null), null);
  assert.equal(addressToUrl("   "), null);
});

test("decidePreselectedRole: no host record => host (this is the first computer)", () => {
  assert.deepEqual(decidePreselectedRole({ host: null }), { role: "host", reason: "no-host" });
  assert.deepEqual(
    decidePreselectedRole({ host: { localAddresses: [] } }),
    { role: "host", reason: "no-host" },
  );
});

test("decidePreselectedRole: recently-checked-in host => client", () => {
  const now = 1_000_000_000;
  const office = { host: { localAddresses: ["192.168.1.5:5150"], lastCheckinAt: now - 1000 } };
  assert.equal(decidePreselectedRole(office, { now, staleMs: 60_000 }).role, "client");
});

test("decidePreselectedRole: accepts ISO-string lastCheckinAt", () => {
  const now = Date.parse("2026-06-22T12:00:00.000Z");
  const office = { host: { localAddresses: ["192.168.1.5:5150"], lastCheckinAt: "2026-06-22T11:59:30.000Z" } };
  assert.equal(decidePreselectedRole(office, { now, staleMs: 60_000 }).role, "client");
});

test("decidePreselectedRole: stale host => manual (fail closed)", () => {
  const now = 1_000_000_000;
  const office = { host: { localAddresses: ["192.168.1.5:5150"], lastCheckinAt: now - 999_999_999 } };
  assert.equal(decidePreselectedRole(office, { now, staleMs: 60_000 }).role, "manual");
});

test("decidePreselectedRole: no office => manual", () => {
  assert.equal(decidePreselectedRole(null).role, "manual");
});

test("pickReachableHostUrl returns the first address that answers", async () => {
  const calls = [];
  const probe = async ({ host }) => { calls.push(host); return host === "192.168.1.9"; };
  const url = await pickReachableHostUrl(["10.0.0.1:5150", "192.168.1.9:5150"], { probe });
  assert.equal(url, "https://192.168.1.9:5150");
  assert.deepEqual(calls, ["10.0.0.1", "192.168.1.9"]);
});

test("pickReachableHostUrl returns null when nothing answers", async () => {
  const url = await pickReachableHostUrl(["10.0.0.1:5150"], { probe: async () => false });
  assert.equal(url, null);
});
