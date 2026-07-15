/**
 * B8: the request-audit middleware had three gaps — (a) it only fired on
 * /api/*, so the entire /tablet/api/* surface (including mutations) went
 * unaudited; (b) it read req.user only, so tablet actions (req.tabletUser)
 * logged no user; (c) it never logged successful PHI reads, only mutations
 * + auth failures + 5xx, and had no entityType/entityId. This test pins
 * buildAuditEntry() (actor resolution + entity extraction) and
 * isPhiAuditPath() (which GETs are worth auditing) in isolation from the
 * Express app.
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
    path: "/api/jobs/abc-123",
    user: { id: "u1", officeId: "o1", role: "owner" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 12);

  assert.equal(entry.method, "GET");
  assert.equal(entry.entityType, "job");
  assert.equal(entry.entityId, "abc-123");
  assert.equal(entry.userId, "u1");
  assert.equal(entry.officeId, "o1");
  assert.equal(entry.role, "owner");
  assert.equal(entry.outcome, "success");
  assert.equal(entry.statusCode, 200);
});

test("buildAuditEntry resolves the tablet actor from req.tabletUser (no req.user) and has no role", () => {
  const req = fakeReq({
    method: "PUT",
    path: "/tablet/api/jobs/j9",
    tabletUser: { userId: "tu1", officeId: "o1", sessionId: "s1" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 8);

  assert.equal(entry.userId, "tu1");
  assert.equal(entry.officeId, "o1");
  assert.equal(entry.role, undefined);
  assert.equal(entry.entityType, "job");
  assert.equal(entry.entityId, "j9");
});

test("buildAuditEntry extracts a nested entityType (comments under a job) but keeps the job id", () => {
  const req = fakeReq({
    method: "GET",
    path: "/api/jobs/job-42/comments",
    user: { id: "u1", officeId: "o1", role: "staff" },
  });

  const entry = buildAuditEntry(req, fakeRes(200), 5);

  assert.equal(entry.entityType, "comment");
  assert.equal(entry.entityId, "job-42");
});

test("buildAuditEntry leaves entityId undefined for a collection route", () => {
  const req = fakeReq({ method: "GET", path: "/api/jobs" });

  const entry = buildAuditEntry(req, fakeRes(200), 3);

  assert.equal(entry.entityType, "job");
  assert.equal(entry.entityId, undefined);
});

test("isPhiAuditPath is true for app and tablet job routes", () => {
  assert.equal(isPhiAuditPath("/api/jobs/x"), true);
  assert.equal(isPhiAuditPath("/tablet/api/jobs/x"), true);
});

test("isPhiAuditPath is false for health/heartbeat and other non-PHI system routes", () => {
  assert.equal(isPhiAuditPath("/api/health"), false);
  assert.equal(isPhiAuditPath("/tablet/api/heartbeat"), false);
  assert.equal(isPhiAuditPath("/tablet/api/office-info"), false);
  assert.equal(isPhiAuditPath("/tablet/api/config"), false);
});
