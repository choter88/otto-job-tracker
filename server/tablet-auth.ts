import { randomBytes, randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { tabletSessions, users } from "@shared/schema";

const TABLET_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ── In-memory slot tracking (migrated from routes.ts) ──
// Tracks active tablet sessions for slot enforcement (separate from DB sessions).
const tabletSlotSessions = new Map<string, number>();
const TABLET_SLOT_EXPIRY_MS = 60_000; // 60 seconds without heartbeat = expired

export function getActiveTabletSessionCount(): number {
  const now = Date.now();
  const expired: string[] = [];
  tabletSlotSessions.forEach((lastSeen, id) => {
    if (now - lastSeen > TABLET_SLOT_EXPIRY_MS) {
      expired.push(id);
    }
  });
  expired.forEach((id) => tabletSlotSessions.delete(id));
  return tabletSlotSessions.size;
}

export function trackTabletSlotHeartbeat(sessionId: string): void {
  tabletSlotSessions.set(sessionId, Date.now());
}

export function isNewTabletSlotSession(sessionId: string): boolean {
  return !tabletSlotSessions.has(sessionId);
}

// ── Typed tablet user on request ──
export interface TabletUser {
  userId: string;
  officeId: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      tabletUser?: TabletUser;
    }
  }
}

// ── Session CRUD ──

export async function createTabletSession(
  userId: string,
  officeId: string,
  userAgent?: string,
): Promise<string> {
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TABLET_SESSION_TTL_MS);

  db.insert(tabletSessions)
    .values({
      id,
      token,
      userId,
      officeId,
      userAgent: userAgent || null,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    })
    .run();

  return token;
}

export async function validateTabletToken(
  token: string,
): Promise<TabletUser | null> {
  if (!token) return null;

  const now = new Date();
  const rows = db
    .select({
      id: tabletSessions.id,
      userId: tabletSessions.userId,
      officeId: tabletSessions.officeId,
      expiresAt: tabletSessions.expiresAt,
    })
    .from(tabletSessions)
    .where(eq(tabletSessions.token, token))
    .limit(1)
    .all();

  const session = rows[0];
  if (!session) return null;

  if (session.expiresAt < now) {
    // Expired — clean up
    db.delete(tabletSessions).where(eq(tabletSessions.id, session.id)).run();
    return null;
  }

  // Update lastSeenAt
  db.update(tabletSessions)
    .set({ lastSeenAt: now })
    .where(eq(tabletSessions.id, session.id))
    .run();

  return {
    userId: session.userId,
    officeId: session.officeId,
    sessionId: session.id,
  };
}

export async function invalidateTabletSession(sessionId: string): Promise<void> {
  db.delete(tabletSessions).where(eq(tabletSessions.id, sessionId)).run();
}

export async function invalidateTabletSessionByToken(token: string): Promise<void> {
  db.delete(tabletSessions).where(eq(tabletSessions.token, token)).run();
}

export async function invalidateTabletSessionsForUser(userId: string): Promise<void> {
  db.delete(tabletSessions).where(eq(tabletSessions.userId, userId)).run();
}

export function cleanExpiredTabletSessions(): void {
  const now = Date.now();
  db.delete(tabletSessions)
    .where(sql`${tabletSessions.expiresAt} < ${now}`)
    .run();
}

// ── Active sessions query (for settings panel) ──
export function getActiveTabletSessions(officeId: string) {
  const now = new Date();
  return db
    .select({
      id: tabletSessions.id,
      userId: tabletSessions.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      lastSeenAt: tabletSessions.lastSeenAt,
      createdAt: tabletSessions.createdAt,
      userAgent: tabletSessions.userAgent,
    })
    .from(tabletSessions)
    .innerJoin(users, eq(tabletSessions.userId, users.id))
    .where(
      and(
        eq(tabletSessions.officeId, officeId),
        gt(tabletSessions.expiresAt, now),
      ),
    )
    .all();
}

// ── Middleware ──

export function requireTabletAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Tablet authentication required" });
  }

  const token = authHeader.slice(7);
  validateTabletToken(token).then((tabletUser) => {
    if (!tabletUser) {
      return res.status(401).json({ error: "Invalid or expired tablet session" });
    }
    req.tabletUser = tabletUser;
    next();
  }).catch(() => {
    res.status(500).json({ error: "Authentication error" });
  });
}
