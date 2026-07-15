/**
 * B8: the request-audit middleware had three gaps — (a) it only fired on
 * /api/*, so the entire /tablet/api/* surface (including mutations) went
 * unaudited; (b) it read req.user only, so tablet actions (req.tabletUser)
 * logged no user; (c) it never logged successful PHI reads, only mutations
 * + auth failures + 5xx, and had no entityType/entityId. This test pins
 * buildAuditEntry() (actor resolution + entity extraction) and
 * isPhiAuditPath() (which GETs are worth auditing) in isolation from the
 * Express app.
 *
 * B8.2 (review fix): the original entity extraction used singularize() +
 * a NON_ID_PATH_SEGMENTS denylist, which (a) mangled words like "status"
 * into "statu" and (b) could yield a literal resource word (e.g.
 * "offices") as entityId when a route had no id segment at all. It was
 * replaced with an id-shape rule: entityId is the first path segment that
 * matches the same id shapes normalizeAuditPath() collapses to ":id"
 * (uuid | 24+ hex | 20+ opaque | pure digits), and entityType is the raw
 * segment before it — no singularization. Test fixtures below use
 * pure-digit ids (e.g. "9", "42") since digit segments match with no
 * minimum length, keeping ids short and readable while still being
 * genuinely id-shaped. Also: /tablet/api/poll was dropped from the PHI
 * audit path list — it returns only {lastModified}, no PHI, and was
 * polled every ~5s, producing pure spam.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditEntry, isPhiAuditPath } from "../server/audit-logger";

function fakeReq(overrides: Record<string, unknown>): any {
  return { method: "GET", path: "/", headers: {}, ...overrides };
}

function fakeRes(statusCode: number): any {
  return { statusCode };
}

test("buildAuditEntry resolves the app actor from req.user and extracts entity from the raw path", () => {
  const req = fakeReq({
    method: "GET",
    path: "/api/jobs/42",
    user: { id: "u1", officeId: "o1", role: "owner" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 12);

  assert.equal(entry.method, "GET");
  assert.equal(entry.entityType, "jobs");
  assert.equal(entry.entityId, "42");
  assert.equal(entry.userId, "u1");
  assert.equal(entry.officeId, "o1");
  assert.equal(entry.role, "owner");
  assert.equal(entry.outcome, "success");
  assert.equal(entry.statusCode, 200);
});

test("buildAuditEntry resolves the tablet actor from req.tabletUser (no req.user) and has no role", () => {
  const req = fakeReq({
    method: "PUT",
    path: "/tablet/api/jobs/9",
    tabletUser: { userId: "tu1", officeId: "o1", sessionId: "s1" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 8);

  assert.equal(entry.userId, "tu1");
  assert.equal(entry.officeId, "o1");
  assert.equal(entry.role, undefined);
  assert.equal(entry.entityType, "jobs");
  assert.equal(entry.entityId, "9");
});

test("buildAuditEntry keeps entityType as the resource segment before the id (comments under a job)", () => {
  const req = fakeReq({
    method: "GET",
    path: "/api/jobs/42/comments",
    user: { id: "u1", officeId: "o1", role: "staff" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 5);

  assert.equal(entry.entityType, "jobs");
  assert.equal(entry.entityId, "42");
});

test("buildAuditEntry leaves entityId undefined for a collection route", () => {
  const req = fakeReq({ method: "GET", path: "/api/jobs" });

  const entry = buildAuditEntry(req, fakeRes(200), 3);

  assert.equal(entry.entityType, "jobs");
  assert.equal(entry.entityId, undefined);
});

test("buildAuditEntry does not mangle entityType via singularization (status route)", () => {
  const req = fakeReq({
    method: "PUT",
    path: "/tablet/api/jobs/9/status",
    tabletUser: { userId: "tu1", officeId: "o1", sessionId: "s1" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 4);

  assert.equal(entry.entityType, "jobs");
  assert.notEqual(entry.entityType, "statu");
  assert.equal(entry.entityId, "9");
});

test("buildAuditEntry does not yield a literal resource word as entityId for non-jobs resources", () => {
  const req = fakeReq({
    method: "PATCH",
    path: "/api/admin/offices/5/status",
    user: { id: "u1", officeId: "o1", role: "owner" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 6);

  assert.equal(entry.entityType, "offices");
  assert.equal(entry.entityId, "5");
  assert.notEqual(entry.entityId, "offices");
});

test("isPhiAuditPath is true for app and tablet job routes", () => {
  assert.equal(isPhiAuditPath("/api/jobs/x"), true);
  assert.equal(isPhiAuditPath("/tablet/api/jobs/x"), true);
});

test("isPhiAuditPath is false for health/heartbeat/poll and other non-PHI system routes", () => {
  assert.equal(isPhiAuditPath("/api/health"), false);
  assert.equal(isPhiAuditPath("/tablet/api/heartbeat"), false);
  assert.equal(isPhiAuditPath("/tablet/api/office-info"), false);
  assert.equal(isPhiAuditPath("/tablet/api/config"), false);
  assert.equal(isPhiAuditPath("/tablet/api/poll"), false);
});
