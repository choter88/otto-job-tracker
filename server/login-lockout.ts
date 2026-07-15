/**
 * Login lockout, persisted to sqlite.
 *
 * The previous implementation tracked failed login attempts in an in-memory
 * Map, which meant a simple app restart reset every attacker's failure
 * counter to zero — restart-and-retry defeated the brute-force protection
 * entirely. This module keeps the same 5-attempt / 15-minute policy but
 * backs it with a raw sqlite table so lockouts survive process restarts.
 *
 * Deliberately NOT part of the drizzle schema / migrations: this is a
 * small, self-contained security table, created lazily on module load.
 */
import { sqlite } from "./db";

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS login_lockout (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    locked_until INTEGER NOT NULL
  )`,
);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const selectStmt = sqlite.prepare(
  `SELECT count AS count, locked_until AS lockedUntil FROM login_lockout WHERE key = ?`,
);
const deleteStmt = sqlite.prepare(`DELETE FROM login_lockout WHERE key = ?`);
const upsertFailureStmt = sqlite.prepare(
  `INSERT INTO login_lockout (key, count, locked_until)
   VALUES (@key, 1, 0)
   ON CONFLICT(key) DO UPDATE SET count = count + 1`,
);
const setLockedUntilStmt = sqlite.prepare(
  `UPDATE login_lockout SET locked_until = @lockedUntil WHERE key = @key`,
);

export function checkLockout(key: string): { locked: boolean; remainingMs: number } {
  const now = Date.now();
  const row = selectStmt.get(key) as { count: number; lockedUntil: number } | undefined;
  if (!row) return { locked: false, remainingMs: 0 };
  if (row.lockedUntil > 0 && row.lockedUntil <= now) {
    // Lazily clear an expired lock.
    deleteStmt.run(key);
    return { locked: false, remainingMs: 0 };
  }
  if (row.lockedUntil > now) {
    return { locked: true, remainingMs: row.lockedUntil - now };
  }
  return { locked: false, remainingMs: 0 };
}

export function recordFailure(key: string): void {
  upsertFailureStmt.run({ key });
  const row = selectStmt.get(key) as { count: number; lockedUntil: number };
  if (row.count >= MAX_LOGIN_ATTEMPTS) {
    setLockedUntilStmt.run({ key, lockedUntil: Date.now() + LOCKOUT_DURATION_MS });
  }
}

export function clearFailures(key: string): void {
  deleteStmt.run(key);
}
