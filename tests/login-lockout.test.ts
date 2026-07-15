/**
 * Login lockout used to live in an in-memory Map (server/auth.ts), which
 * meant an attacker's failed-attempt counter was wiped by any app restart.
 * This pins the replacement: lockout state is persisted to sqlite, so it
 * survives a restart, and is shared by both the password/PIN desktop login
 * and the tablet PIN login.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "otto-login-lockout-"));
process.env.OTTO_DATA_DIR = TEST_DIR;
delete process.env.OTTO_SQLITE_PATH;

const { checkLockout, recordFailure, clearFailures } = await import("../server/login-lockout");

test.after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("5 failures locks the key", () => {
  for (let i = 0; i < 5; i += 1) {
    recordFailure("pin:u1");
  }
  const check = checkLockout("pin:u1");
  assert.equal(check.locked, true);
  assert.ok(check.remainingMs > 0);
});

test("lockout survives a simulated process restart (durable on disk)", () => {
  // Open a second, independent raw connection to the same sqlite file — this
  // is what a fresh process would see after a restart. If the lockout were
  // still an in-memory Map, this second connection would see nothing.
  const sqlitePath = path.join(TEST_DIR, "otto.sqlite");
  const secondConnection = new Database(sqlitePath);
  try {
    const row = secondConnection
      .prepare("SELECT count, locked_until AS lockedUntil FROM login_lockout WHERE key = ?")
      .get("pin:u1") as { count: number; lockedUntil: number } | undefined;

    assert.ok(row, "expected a login_lockout row on disk for pin:u1");
    assert.equal(row!.count, 5);
    assert.ok(row!.lockedUntil > Date.now(), "lockedUntil must be in the future");
  } finally {
    secondConnection.close();
  }
});

test("clearFailures unlocks and removes the row", () => {
  clearFailures("pin:u1");
  const check = checkLockout("pin:u1");
  assert.equal(check.locked, false);

  const sqlitePath = path.join(TEST_DIR, "otto.sqlite");
  const secondConnection = new Database(sqlitePath);
  try {
    const row = secondConnection
      .prepare("SELECT * FROM login_lockout WHERE key = ?")
      .get("pin:u1");
    assert.equal(row, undefined, "row must be gone after clearFailures");
  } finally {
    secondConnection.close();
  }
});
