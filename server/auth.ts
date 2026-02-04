import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

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
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  // HIPAA-compliant session timeout: 15 minutes of inactivity
  const SESSION_TIMEOUT_MS = 1000 * 60 * 15; // 15 minutes
  
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: true, // Required for rolling sessions
    saveUninitialized: false,
    store: storage.sessionStore,
    rolling: true, // Reset session expiry on every request (activity extends session)
    cookie: {
      httpOnly: true,
      maxAge: SESSION_TIMEOUT_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  };

  const sessionMiddleware = session(sessionSettings);

  app.set("trust proxy", 1);
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      const user = await storage.getUserByEmail(email);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    }),
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
    const { inviteToken, ...userData } = req.body;
    
    // Validate password complexity
    const passwordValidation = validatePasswordComplexity(userData.password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        error: "Password does not meet complexity requirements",
        details: passwordValidation.errors 
      });
    }
    
    const existingUser = await storage.getUserByEmail(userData.email);
    if (existingUser) {
      return res.status(400).send("Email already exists");
    }

    let invitation = null;
    let userOfficeId = null;
    let userRole: string | undefined = undefined;

    if (inviteToken) {
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
      
      if (invitation.email.toLowerCase() !== userData.email.toLowerCase()) {
        return res.status(400).send("Email does not match invitation");
      }

      userOfficeId = invitation.officeId;
      userRole = invitation.role;
    }

    const user = await storage.createUser({
      ...userData,
      firstName: userData.firstName || userData.username || "User",
      lastName: userData.lastName || "",
      password: await hashPassword(userData.password),
      officeId: userOfficeId,
      role: userRole,
    });

    if (invitation) {
      await storage.acceptInvitation(inviteToken, user.id);
    }

    req.login(user, (err) => {
      if (err) return next(err);
      res.status(201).json(user);
    });
  });

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(req.user);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });

  return sessionMiddleware;
}
