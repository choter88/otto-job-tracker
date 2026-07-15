import { test } from "node:test";
import assert from "node:assert";
import { requireAuth } from "../server/middleware.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test 1: requireAuth with unauthenticated request returns 401
test("requireAuth middleware returns 401 when !isAuthenticated()", () => {
  let statusCode = 0;
  let jsonData: any = null;
  let nextCalled = false;

  const req = {
    isAuthenticated: () => false,
    user: undefined,
  } as any;

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      jsonData = data;
      return res;
    },
  } as any;

  const next = () => {
    nextCalled = true;
  };

  requireAuth(req, res, next);

  assert.strictEqual(statusCode, 401, "status should be 401");
  assert.ok(jsonData?.error, "response should have error field");
  assert.strictEqual(nextCalled, false, "next() should not be called");
});

// Test 2: requireAuth with authenticated request calls next()
test("requireAuth middleware calls next() when isAuthenticated()", () => {
  let nextCalled = false;

  const req = {
    isAuthenticated: () => true,
    user: { id: "test-user", role: "owner" },
  } as any;

  const res = {} as any;

  const next = () => {
    nextCalled = true;
  };

  requireAuth(req, res, next);

  assert.strictEqual(nextCalled, true, "next() should be called");
});

// Test 3: Source assertion — qr-setup route includes requireAuth
test("qr-setup route registration includes requireAuth middleware", () => {
  const tabletRoutesPath = resolve(__dirname, "../server/tablet-routes.ts");
  const content = readFileSync(tabletRoutesPath, "utf-8");

  const qrSetupMatch = content.match(/app\.get\("\/tablet\/api\/qr-setup",\s*requireAuth/);
  assert.ok(
    qrSetupMatch,
    'qr-setup route should include requireAuth middleware: app.get("/tablet/api/qr-setup", requireAuth, ...)',
  );
});
