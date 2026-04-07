import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import SqliteStoreFactory from "better-sqlite3-session-store";
import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { hashSecret, verifySecret } from "./secret-hash";
import { isValidSixDigitPin, normalizeLoginId } from "./auth-identifiers";

/**
 * Track session IDs that originated from localhost (the Host's own browser).
 * On quit we delete only these, preserving Client sessions for reconnection.
 */
const localSessionIds = new Set<string>();

function isLocalAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// ── Login rate limiting / lockout ──
// After MAX_LOGIN_ATTEMPTS failed attempts, the account is locked for LOCKOUT_DURATION_MS.
// In-memory only — cleared on server restart (acceptable for LAN-first desktop app).
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkLockout(key: string): { locked: boolean; remainingMs: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return { locked: false, remainingMs: 0 };
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    loginAttempts.delete(key);
    return { locked: false, remainingMs: 0 };
  }
  if (entry.lockedUntil > now) {
    return { locked: true, remainingMs: entry.lockedUntil - now };
  }
  return { locked: false, remainingMs: 0 };
}

function recordFailure(key: string): void {
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(key, entry);
}

function clearFailures(key: string): void {
  loginAttempts.delete(key);
}

function withoutPassword(user: SelectUser) {
  const { password: _password, pinHash: _pinHash, ...rest } = user;
  return rest;
}

// HIPAA-compliant password complexity requirements
export function validatePasswordComplexity(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push("Password must be at least 12 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;':\",./<>?)");
  }
  
  return { valid: errors.length === 0, errors };
}

async function hashPassword(password: string) {
  return hashSecret(password);
}

async function comparePasswords(supplied: string, stored: string) {
  return verifySecret(supplied, stored);
}

export function setupAuth(app: Express) {
  const SESSION_TIMEOUT_MS = 1000 * 60 * 15; // 15 minutes (HIPAA)

  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set");
    }
    process.env.SESSION_SECRET = randomBytes(32).toString("hex");
    console.warn("SESSION_SECRET was not set; generated a temporary one for this dev run.");
  }

  // Persistent SQLite session store — survives app restarts
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const sessionDbPath = path.join(dataDir, "sessions.sqlite");
  const sessionDb = new Database(sessionDbPath);
  sessionDb.pragma("journal_mode = WAL");

  const SqliteStore = SqliteStoreFactory(session);
  const sessionStore = new SqliteStore({
    client: sessionDb,
    expired: {
      clear: true,
      intervalMs: SESSION_TIMEOUT_MS,
    },
  });

  const cookieSecure =
    process.env.OTTO_COOKIE_SECURE === "true"
      ? true
      : process.env.OTTO_COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production";

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    rolling: true, // Reset session expiry on every request (activity extends session)
    cookie: {
      httpOnly: true,
      maxAge: SESSION_TIMEOUT_MS,
      sameSite: 'strict',
      secure: cookieSecure,
    },
  };

  const sessionMiddleware = session(sessionSettings);

  if (process.env.OTTO_TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
  }
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "identifier", passReqToCallback: true },
      async (req, identifier, password, done) => {
        const fallbackEmail = typeof req.body?.email === "string" ? req.body.email : "";
        const suppliedIdentifier =
          typeof identifier === "string" && identifier.trim()
            ? identifier
            : fallbackEmail;

        const user = await storage.getUserByIdentifier(suppliedIdentifier);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        } else {
          return done(null, user);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        console.error(`Failed to deserialize user: No user found for id ${id}`);
        return done(null, false);
      }
      done(null, user);
    } catch (error) {
      console.error(`Error deserializing user ${id}:`, error);
      done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    const inviteToken =
      typeof req.body?.inviteToken === "string" ? req.body.inviteToken.trim() : undefined;

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }
    if (!firstName) {
      return res.status(400).json({ error: "First name is required" });
    }
    if (!lastName) {
      return res.status(400).json({ error: "Last name is required" });
    }
    
    // Validate password complexity
    const passwordValidation = validatePasswordComplexity(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: "Password does not meet complexity requirements",
        details: passwordValidation.errors 
      });
    }
    
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).send("Email already exists");
    }

    let invitation = null;
    let userOfficeId = null;
    let userRole: SelectUser["role"] | undefined = undefined;

    if (!inviteToken) {
      return res.status(400).json({
        error: "Self sign-up now requires Host approval. Use Request Access on the sign-in screen.",
      });
    }

    invitation = await storage.getInvitationByToken(inviteToken);

    if (!invitation) {
      return res.status(400).send("Invalid invitation");
    }

    if (invitation.status !== 'pending') {
      return res.status(400).send("Invitation already used");
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      return res.status(400).send("Invitation expired");
    }

    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).send("Email does not match invitation");
    }

    userOfficeId = invitation.officeId;
    userRole = invitation.role;

    const user = await storage.createUser({
      email,
      firstName,
      lastName,
      password: await hashPassword(password),
      officeId: userOfficeId,
      role: userRole,
    });

    if (invitation) {
      await storage.acceptInvitation(inviteToken, user.id);
    }

    // Regenerate session to prevent session fixation (F-04)
    req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);
      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(withoutPassword(user));
      });
    });
  });

  app.post("/api/login", (req, res, next) => {
    const identifier = typeof req.body?.identifier === "string"
      ? req.body.identifier.trim().toLowerCase() : "";
    const lockKey = `pwd:${identifier}`;

    if (identifier) {
      const lockCheck = checkLockout(lockKey);
      if (lockCheck.locked) {
        const mins = Math.ceil(lockCheck.remainingMs / 60000);
        return res.status(429).json({
          error: `Too many failed attempts. Try again in ${mins} minute(s).`,
        });
      }
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        if (identifier) recordFailure(lockKey);
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      if (identifier) clearFailures(lockKey);
      // Regenerate session to prevent session fixation (F-04)
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          // Track Host (localhost) sessions for selective cleanup on quit
          if (isLocalAddress(req.ip || req.socket?.remoteAddress)) {
            localSessionIds.add(req.sessionID);
          }
          try {
            const { trackEvent } = require("./usage-tracker");
            trackEvent({ userId: user.id, officeId: user.officeId, eventType: "user_login" });
          } catch { /* non-critical */ }
          res.status(200).json(withoutPassword(user));
        });
      });
    })(req, res, next);
  });

  app.post("/api/login/pin", async (req, res, next) => {
    const loginId = normalizeLoginId(
      typeof req.body?.loginId === "string" ? req.body.loginId : "",
    );
    const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";

    if (!loginId) {
      return res.status(400).json({ error: "Login ID is required" });
    }
    if (!isValidSixDigitPin(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 6 digits" });
    }

    const lockCheck = checkLockout(`pin:${loginId}`);
    if (lockCheck.locked) {
      const mins = Math.ceil(lockCheck.remainingMs / 60000);
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${mins} minute(s).`,
      });
    }

    const user = await storage.getUserByLoginId(loginId);
    if (!user || !user.pinHash || !(await verifySecret(pin, user.pinHash))) {
      recordFailure(`pin:${loginId}`);
      return res.status(401).json({ error: "Invalid Login ID or PIN" });
    }

    clearFailures(`pin:${loginId}`);
    // Regenerate session to prevent session fixation (F-04)
    req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);
      req.login(user, (err) => {
        if (err) return next(err);
        if (isLocalAddress(req.ip || req.socket?.remoteAddress)) {
          localSessionIds.add(req.sessionID);
        }
        res.status(200).json(withoutPassword(user));
      });
    });
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(withoutPassword(req.user as SelectUser));
  });

  // Expose a function to clear only Host (localhost) sessions on quit.
  // Client sessions are preserved so they can reconnect transparently.
  (globalThis as any).__ottoClearHostSessions = () => {
    try {
      for (const sid of localSessionIds) {
        sessionStore.destroy(sid, () => {});
      }
      localSessionIds.clear();
    } catch {
      // best-effort
    }
  };

  return sessionMiddleware;
}
