import type { Express, Request } from "express";
import fs from "fs";
import { createServer as createHttpServer, type Server as HttpServer } from "http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "https";
import { randomBytes } from "crypto";
import { setupAuth, validatePasswordComplexity } from "./auth";
import { storage } from "./storage";
import {
  offices,
  users,
  insertJobSchema,
  insertJobCommentSchema,
  insertNotificationRuleSchema,
  insertInvitationSchema,
  insertSmsOptInSchema,
  insertAdminAuditLogSchema,
} from "@shared/schema";
import { sendSMS } from "./twilioClient";
import { requireAdmin } from "./middleware";
import { notifyJobStatusChange, notifyNewComment, notifyOverdueJob } from "./notification-service";
import { generateJobSummary, checkAndRegenerateSummary } from "./ai-summary-service";
import { getRecentErrors, getErrorStats, clearErrors } from "./error-logger";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { hashSecret } from "./secret-hash";
import { activateLicense, forceCheckin, getLicenseSnapshot } from "./license";

// PHI access logging helper for HIPAA compliance
async function logPhiAccess(
  req: Request,
  action: 'view' | 'create' | 'update' | 'delete' | 'export',
  entityType: 'job' | 'comment' | 'archived_job' | 'patient_list',
  entityId: string,
  orderId?: string,
  details?: Record<string, any>
) {
  if (!req.user) return;
  
  try {
    const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
    const forwardedFor = trustProxy
      ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      : undefined;
    const ipAddress = forwardedFor || req.socket.remoteAddress || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    await storage.createPhiAccessLog({
      userId: req.user.id,
      officeId: req.user.officeId || null,
      action,
      entityType,
      entityId,
      orderId: orderId || null,
      ipAddress,
      userAgent,
      details: details || null,
    });
  } catch (error) {
    console.error('Failed to log PHI access:', error);
    // Don't throw - logging failure shouldn't break the request
  }
}

export type AppServer = HttpServer | HttpsServer;

function createAppServer(app: Express): AppServer {
  if (process.env.OTTO_TLS !== "true") {
    return createHttpServer(app);
  }

  const keyPath = process.env.OTTO_TLS_KEY_PATH;
  const certPath = process.env.OTTO_TLS_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error("OTTO_TLS is true but OTTO_TLS_KEY_PATH/OTTO_TLS_CERT_PATH are not set");
  }

  return createHttpsServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    app,
  );
}

function normalizeRemoteIp(ip: string): string {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeRemoteIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1";
}

const STAFF_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoids confusing chars

function randomCodeChars(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += STAFF_CODE_ALPHABET[bytes[i] % STAFF_CODE_ALPHABET.length];
  }
  return out;
}

function generateStaffCode(): string {
  const a = randomCodeChars(4);
  const b = randomCodeChars(4);
  return `${a}-${b}`;
}

function normalizeStaffCode(input: string): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function registerRoutes(app: Express): { server: AppServer; sessionMiddleware: any } {
  // Setup authentication
  const sessionMiddleware = setupAuth(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/license/status", (_req, res) => {
    res.json(getLicenseSnapshot());
  });

  app.post("/api/license/activate", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role !== "owner" && req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Only the Owner can do this" });
    }

    try {
      const activationCode =
        typeof req.body?.activationCode === "string" ? req.body.activationCode.trim() : "";
      const snapshot = await activateLicense(activationCode);
      res.json(snapshot);
    } catch (error: any) {
      const status = typeof error?.statusCode === "number" ? error.statusCode : 400;
      res.status(status).json({ error: error?.message || "Activation failed" });
    }
  });

  app.post("/api/license/checkin", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role !== "owner" && req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Only the Owner can do this" });
    }

    try {
      const snapshot = await forceCheckin();
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Check-in failed" });
    }
  });

  // Setup / onboarding routes (desktop-first)
  app.get("/api/setup/status", async (_req, res) => {
    try {
      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;

      const allOffices = officeCount > 0 ? await storage.getAllOffices() : [];
      const primaryOffice = allOffices[0];
      const settings = (primaryOffice?.settings || {}) as Record<string, any>;
      const staffSignupConfigured = Boolean(settings?.staffSignup?.codeHash);

      res.json({
        initialized: officeCount > 0 && userCount > 0,
        officeId: primaryOffice?.id || null,
        officeName: primaryOffice?.name || null,
        staffSignupConfigured,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to read setup status" });
    }
  });

  app.post("/api/setup/bootstrap", async (req, res, next) => {
    // Do not trust proxy headers for setup restrictions.
    const remote = normalizeRemoteIp(req.socket.remoteAddress || "");
    if (!isLoopbackIp(remote)) {
      return res.status(403).json({
        error: "Setup must be completed on the Host computer.",
      });
    }

    try {
      const activationCode =
        typeof req.body?.activationCode === "string" ? req.body.activationCode.trim() : "";
      const officeBody = req.body?.office || {};
      const adminBody = req.body?.admin || {};

      const officeName = typeof officeBody?.name === "string" ? officeBody.name.trim() : "";
      const officeAddress =
        typeof officeBody?.address === "string" ? officeBody.address.trim() : undefined;
      const officePhone = typeof officeBody?.phone === "string" ? officeBody.phone.trim() : undefined;
      const officeEmail = typeof officeBody?.email === "string" ? officeBody.email.trim() : undefined;

      const adminEmail =
        typeof adminBody?.email === "string" ? adminBody.email.trim().toLowerCase() : "";
      const adminPassword = typeof adminBody?.password === "string" ? adminBody.password : "";
      const adminFirstName = typeof adminBody?.firstName === "string" ? adminBody.firstName.trim() : "";
      const adminLastName = typeof adminBody?.lastName === "string" ? adminBody.lastName.trim() : "";

      if (!activationCode) {
        return res.status(400).json({ error: "Activation Code is required" });
      }
      if (!officeName) {
        return res.status(400).json({ error: "Office name is required" });
      }
      if (!adminEmail) {
        return res.status(400).json({ error: "Admin email is required" });
      }
      if (!adminFirstName) {
        return res.status(400).json({ error: "Admin first name is required" });
      }
      if (!adminLastName) {
        return res.status(400).json({ error: "Admin last name is required" });
      }

      const passwordValidation = validatePasswordComplexity(adminPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: "Password does not meet complexity requirements",
          details: passwordValidation.errors,
        });
      }

      const [officeStats] = await db.select({ count: sql`count(*)` }).from(offices);
      const [userStats] = await db.select({ count: sql`count(*)` }).from(users);
      const officeCount = Number(officeStats?.count) || 0;
      const userCount = Number(userStats?.count) || 0;

      if (userCount > 0) {
        return res.status(409).json({ error: "This office is already set up." });
      }
      if (officeCount > 1) {
        return res.status(409).json({ error: "Multiple offices exist. Please contact support." });
      }

      const existingUser = await storage.getUserByEmail(adminEmail);
      if (existingUser) {
        return res.status(409).json({ error: "A user with this email already exists." });
      }

      let licenseSnapshot = getLicenseSnapshot();
      let activationWarning: string | null = null;
      try {
        licenseSnapshot = await activateLicense(activationCode);
      } catch (error: any) {
        const status = typeof error?.statusCode === "number" ? error.statusCode : 0;
        const code = typeof error?.code === "string" ? error.code : "";
        const msg = typeof error?.message === "string" ? error.message : "Activation failed";

        // Hard failures the user must fix in the portal before continuing.
        if (status === 409 || code === "HOST_ALREADY_ACTIVATED") {
          return res.status(409).json({
            error:
              "This office is already activated on another Host. In the portal, click “Replace Host”, then try again.",
          });
        }
        if (status >= 400 && status < 500) {
          return res.status(status).json({ error: msg });
        }

        // Soft failure (network/timeout): allow setup, but the app will go read-only after grace.
        activationWarning =
          "We couldn’t verify your Activation Code right now. Otto Tracker will work for up to 7 days, then become read-only until activation succeeds.";
        licenseSnapshot = getLicenseSnapshot();
      }

      const staffCode = generateStaffCode();
      const staffCodeHash = await hashSecret(normalizeStaffCode(staffCode));

      const office =
        officeCount === 1
          ? (await storage.getAllOffices())[0]
          : await storage.createOffice({
              name: officeName,
              address: officeAddress,
              phone: officePhone,
              email: officeEmail,
            });

      const mergedSettings: Record<string, any> = { ...(office.settings || {}) };
      mergedSettings.staffSignup = {
        codeHash: staffCodeHash,
        rotatedAt: Date.now(),
      };
      const activationSucceeded = licenseSnapshot.mode === "ACTIVE";
      mergedSettings.licensing = {
        activationCodeLast4: activationCode.slice(-4),
        activationAttemptedAt: Date.now(),
        activationVerifiedAt: activationSucceeded ? licenseSnapshot.activatedAt || Date.now() : null,
      };

      const updatedOffice = await storage.updateOffice(office.id, {
        name: officeName,
        address: officeAddress,
        phone: officePhone,
        email: officeEmail,
        settings: mergedSettings,
      });

      const user = await storage.createUser({
        email: adminEmail,
        firstName: adminFirstName,
        lastName: adminLastName,
        password: await hashSecret(adminPassword),
        officeId: updatedOffice.id,
        role: "owner",
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json({
          ok: true,
          office: updatedOffice,
          user,
          staffCode,
          license: licenseSnapshot,
          activationWarning,
        });
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Setup failed" });
    }
  });

  app.post("/api/setup/staff-code/regenerate", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    if (req.user.role !== "owner") return res.status(403).json({ error: "Only the owner can do this" });

    try {
      const office = await storage.getOffice(req.user.officeId);
      if (!office) return res.status(404).json({ error: "Office not found" });

      const staffCode = generateStaffCode();
      const staffCodeHash = await hashSecret(normalizeStaffCode(staffCode));

      const mergedSettings: Record<string, any> = { ...(office.settings || {}) };
      mergedSettings.staffSignup = {
        codeHash: staffCodeHash,
        rotatedAt: Date.now(),
      };

      await storage.updateOffice(office.id, { settings: mergedSettings });
      res.json({ staffCode });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to generate staff code" });
    }
  });

  // Job routes
  app.get("/api/jobs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const jobs = await storage.getJobsByOffice(req.user.officeId);
      
      // Log PHI access for viewing patient list
      await logPhiAccess(req, 'view', 'patient_list', req.user.officeId, undefined, { jobCount: jobs.length });
      
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Check for duplicate tray number
  app.get("/api/jobs/check-tray-number", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    
    try {
      const { trayNumber, excludeJobId } = req.query;
      if (!trayNumber || typeof trayNumber !== 'string') {
        return res.status(400).json({ error: "Tray number is required" });
      }
      
      const existingJob = await storage.getJobByTrayNumber(
        req.user.officeId, 
        trayNumber,
        typeof excludeJobId === 'string' ? excludeJobId : undefined
      );
      
      res.json({ exists: !!existingJob, jobId: existingJob?.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    
    try {
      const requestedId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (requestedId) {
        const existing = await storage.getJob(requestedId);
        if (existing && existing.officeId === req.user.officeId) {
          return res.json(existing);
        }
      }

      // Get office settings to check identifier mode
      const office = await storage.getOffice(req.user.officeId);
      const officeSettings = (office?.settings || {}) as Record<string, any>;
      const jobIdentifierMode = officeSettings.jobIdentifierMode || "patientName";
      
      // Validate based on identifier mode
      if (jobIdentifierMode === "trayNumber") {
        if (!req.body.trayNumber || req.body.trayNumber.trim() === "") {
          return res.status(400).json({ error: "Tray number is required when using tray identifier mode" });
        }
        
        // Check for duplicate tray number
        const existingJob = await storage.getJobByTrayNumber(req.user.officeId, req.body.trayNumber.trim());
        if (existingJob) {
          return res.status(409).json({ 
            error: "Duplicate tray number", 
            message: "A job with this tray number already exists. Please check for accuracy.",
            existingJobId: existingJob.id 
          });
        }
      } else {
        if (!req.body.patientFirstInitial || !req.body.patientLastName) {
          return res.status(400).json({ error: "Patient first initial and last name are required" });
        }
      }
      
      const jobData = insertJobSchema.parse({
        ...req.body,
        officeId: req.user.officeId,
        createdBy: req.user.id
      });
      
      const job = await storage.createJob(jobData);
      
      // Log PHI access for creating patient record
      await logPhiAccess(req, 'create', 'job', job.id, job.orderId, { 
        jobType: job.jobType,
        patientId: job.trayNumber || `${job.patientFirstInitial}. ${job.patientLastName}`
      });
      
      res.status(201).json(job);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/jobs/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const oldJob = await storage.getJob(req.params.id);
      
      // Check for duplicate tray number if tray number is being updated
      if (req.body.trayNumber && oldJob) {
        const office = await storage.getOffice(oldJob.officeId);
        const officeSettings = (office?.settings || {}) as Record<string, any>;
        const jobIdentifierMode = officeSettings.jobIdentifierMode || "patientName";
        
        if (jobIdentifierMode === "trayNumber" && req.body.trayNumber !== oldJob.trayNumber) {
          const existingJob = await storage.getJobByTrayNumber(oldJob.officeId, req.body.trayNumber.trim(), req.params.id);
          if (existingJob) {
            return res.status(409).json({ 
              error: "Duplicate tray number", 
              message: "A job with this tray number already exists. Please check for accuracy.",
              existingJobId: existingJob.id 
            });
          }
        }
      }
      
      const job = await storage.updateJob(req.params.id, req.body, req.user.id);
      
      // Log PHI access for updating patient record
      await logPhiAccess(req, 'update', 'job', job.id, job.orderId, { 
        updatedFields: Object.keys(req.body),
        patientId: job.trayNumber || `${job.patientFirstInitial}. ${job.patientLastName}`
      });
      
      if (oldJob && req.body.status && oldJob.status !== req.body.status) {
        // Send notifications while job still exists in database (fixes FK violation)
        await notifyJobStatusChange(job, oldJob.status, req.user, storage);
        
        // Regenerate AI summary BEFORE archiving (while job still exists)
        await checkAndRegenerateSummary(req.params.id);
        
        // Archive and delete AFTER notifications if status is terminal
        if (req.body.status === 'completed' || req.body.status === 'cancelled') {
          await storage.archiveJob(job);
          await storage.deleteJob(req.params.id);
        }
      }
      
      res.json(job);
    } catch (error: any) {
      console.error("PUT /api/jobs/:id - Error:", process.env.OTTO_DEBUG === "true" ? error : error?.message);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      // Log PHI access before deletion
      await logPhiAccess(req, 'delete', 'job', req.params.id);
      
      await storage.deleteJob(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/jobs/:id/archive", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      if (job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { finalStatus } = req.body;
      if (!finalStatus) {
        return res.status(400).json({ error: "finalStatus is required" });
      }

      // Update job status first
      const updatedJob = { ...job, status: finalStatus };
      
      // Archive the job
      const archivedJob = await storage.archiveJob(updatedJob);
      
      // Delete from active jobs
      await storage.deleteJob(req.params.id);
      
      res.json(archivedJob);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Archived jobs routes
  app.get("/api/jobs/archived", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const { startDate, endDate, name } = req.query;
      const jobs = await storage.getArchivedJobsByOffice(
        req.user.officeId,
        startDate as string | undefined,
        endDate as string | undefined,
        name as string | undefined
      );
      
      // Log PHI access for viewing archived patient records
      await logPhiAccess(req, 'view', 'archived_job', req.user.officeId, undefined, { 
        jobCount: jobs.length,
        filters: { startDate, endDate, name }
      });
      
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs/archived/:id/restore", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      // newStatus is now optional - will use previousStatus from archive if not provided
      const { newStatus } = req.body;
      const job = await storage.restoreArchivedJob(req.params.id, newStatus);
      res.json(job);
    } catch (error: any) {
      console.error(
        "POST /api/jobs/archived/:id/restore - Error:",
        process.env.OTTO_DEBUG === "true" ? error : error?.message,
      );
      res.status(400).json({ error: error.message });
    }
  });

  // Overdue jobs
  app.get("/api/jobs/overdue", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const overdueJobs = await storage.getOverdueJobs(req.user.officeId);
      res.json(overdueJobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Job comments routes
  app.get("/api/jobs/:jobId/comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const comments = await storage.getJobComments(req.params.jobId);
      
      // Log PHI access for viewing comments
      const job = await storage.getJob(req.params.jobId);
      await logPhiAccess(req, 'view', 'comment', req.params.jobId, job?.orderId, { commentCount: comments.length });
      
      res.json(comments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/jobs/:jobId/comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const requestedId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (requestedId) {
        const existingComments = await storage.getJobComments(req.params.jobId);
        const existing = existingComments.find((comment) => comment.id === requestedId);
        if (existing) {
          return res.json(existing);
        }
      }

      const commentData = insertJobCommentSchema.parse({
        ...req.body,
        jobId: req.params.jobId,
        authorId: req.user.id
      });
      
      const comment = await storage.createJobComment(commentData);
      
      const job = await storage.getJob(req.params.jobId);
      if (job) {
        // Log PHI access for creating comment
        await logPhiAccess(req, 'create', 'comment', comment.id, job.orderId, { jobId: req.params.jobId });
        
        await notifyNewComment(job, comment, req.user, storage);
        // Regenerate AI summary for flagged jobs when new comment is added
        await checkAndRegenerateSummary(req.params.jobId);
      }
      
      res.status(201).json(comment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/jobs/comments/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const comments = await storage.getJobComments(req.body.jobId || "");
      const existingComment = comments.find(c => c.id === req.params.id);
      
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      if (existingComment.authorId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to edit this comment" });
      }
      
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Comment content is required" });
      }
      
      const updatedComment = await storage.updateJobComment(req.params.id, { content: content.trim() });
      
      // Log PHI access for updating comment
      const job = await storage.getJob(req.body.jobId);
      await logPhiAccess(req, 'update', 'comment', req.params.id, job?.orderId, { jobId: req.body.jobId });
      
      res.json(updatedComment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Comment reads routes
  app.get("/api/jobs/unread-comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const unreadJobIds = await storage.getUnreadCommentJobIds(req.user.id, req.user.officeId);
      res.json(unreadJobIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/comment-counts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const commentCounts = await storage.getJobCommentCounts(req.user.officeId);
      res.json(commentCounts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/jobs/:jobId/comment-reads", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const commentRead = await storage.updateCommentRead(req.user.id, req.params.jobId);
      res.json(commentRead);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Job flag routes
  app.post("/api/jobs/:jobId/flag", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Create flag immediately without waiting for summary
      const flag = await storage.flagJob(req.user.id, req.params.jobId);
      
      // Generate AI summary asynchronously in the background
      (async () => {
        try {
          if (process.env.OTTO_DEBUG === "true") {
            console.log(`[AI Summary] Starting async summary generation for job ${req.params.jobId}`);
          }
          const office = await storage.getOffice(job.officeId);
          const summary = await generateJobSummary(req.params.jobId, office?.settings || {});
          await storage.updateJobFlagSummary(req.user.id, req.params.jobId, summary);
          if (process.env.OTTO_DEBUG === "true") {
            console.log(`[AI Summary] Async summary generation completed for job ${req.params.jobId}`);
          }
          
          // TODO: Broadcast via WebSocket that summary is ready
        } catch (error) {
          console.error(`[AI Summary] Error generating async summary for job ${req.params.jobId}:`, error);
        }
      })();
      
      res.status(201).json(flag);
    } catch (error: any) {
      console.error("Error flagging job:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/jobs/:jobId/flag", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.unflagJob(req.user.id, req.params.jobId);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/jobs/flagged", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const flaggedJobs = await storage.getFlaggedJobsByOffice(req.user.officeId);
      res.json(flaggedJobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/:jobId/flagged-by", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const flaggedBy = await storage.getJobFlaggedBy(req.params.jobId);
      res.json(flaggedBy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI summary route
  app.post("/api/jobs/:jobId/summary", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const job = await storage.getJob(req.params.jobId);
      if (!job || job.officeId !== req.user.officeId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const office = await storage.getOffice(job.officeId);
      const summary = await generateJobSummary(req.params.jobId, office?.settings || {});
      
      res.json({ summary });
    } catch (error: any) {
      console.error("Error generating summary:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Office routes
  app.post("/api/offices", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const office = await storage.createOffice(req.body);
      
      // Assign user as owner
      await storage.updateUser(req.user.id, {
        officeId: office.id,
        role: "owner"
      });
      
      res.status(201).json(office);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/offices/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const office = await storage.getOffice(req.params.id);
      if (!office) return res.status(404).json({ error: "Office not found" });
      
      res.json(office);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/offices/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const office = await storage.updateOffice(req.params.id, req.body);
      res.json(office);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Team management routes
  app.get("/api/offices/:id/members", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const members = await storage.getUsersInOffice(req.params.id);
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/offices/:id/join-requests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const requests = await storage.getJoinRequestsByOffice(req.params.id);
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Join request routes
  app.post("/api/join-requests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const { ownerEmail, message } = req.body;
      
      // Find the owner and their office
      const owner = await storage.getUserByEmail(ownerEmail);
      if (!owner || !owner.officeId || owner.role !== 'owner') {
        return res.status(400).json({ error: "Owner not found" });
      }
      
      const request = await storage.createJoinRequest(req.user.id, owner.officeId, message);
      res.status(201).json(request);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/join-requests/:id/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const { role } = req.body;
      await storage.approveJoinRequest(req.params.id, role);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/join-requests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      await storage.rejectJoinRequest(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Invitation routes
  app.post("/api/invitations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    if (req.user.role !== 'owner') return res.status(403).json({ error: "Only owners can invite users" });
    
    try {
      const invitationData = insertInvitationSchema.parse({
        ...req.body,
        officeId: req.user.officeId,
        invitedBy: req.user.id,
      });
      
      // Generate a unique token
      const { nanoid } = await import('nanoid');
      const token = nanoid(32);
      
      // Set expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      const invitation = await storage.createInvitation({
        ...invitationData,
        token,
        expiresAt,
      });
      
      res.status(201).json(invitation);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/invitations", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    
    try {
      const invitations = await storage.getInvitationsByOffice(req.user.officeId);
      res.json(invitations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/invitations/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      // Verify user is owner and invitation belongs to their office
      const invitation = await storage.getInvitationById(req.params.id);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }
      
      if (invitation.officeId !== req.user.officeId || req.user.role !== 'owner') {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.cancelInvitation(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/invitations/verify/:token", async (req, res) => {
    try {
      const invitation = await storage.getInvitationByToken(req.params.token);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: "Invitation already used" });
      }
      if (new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Invitation expired" });
      }

      const office = await storage.getOffice(invitation.officeId);
      const inviter = await storage.getUser(invitation.invitedBy);

      res.json({
        email: invitation.email,
        role: invitation.role,
        message: invitation.message,
        officeId: invitation.officeId,
        officeName: office?.name || 'Unknown Office',
        inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Unknown',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invitations/accept/:token", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      await storage.acceptInvitation(req.params.token, req.user.id);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Notification rules routes
  app.get("/api/notification-rules", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const rules = await storage.getNotificationRulesByOffice(req.user.officeId);
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notification-rules", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const ruleData = insertNotificationRuleSchema.parse({
        ...req.body,
        officeId: req.user.officeId
      });
      
      const rule = await storage.createNotificationRule(ruleData);
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/notification-rules/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    
    try {
      // Verify rule belongs to user's office
      const existingRule = await storage.getNotificationRule(req.params.id);
      if (!existingRule || existingRule.officeId !== req.user.officeId) {
        return res.status(404).json({ error: "Notification rule not found" });
      }
      
      const rule = await storage.updateNotificationRule(req.params.id, req.body);
      res.json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/notification-rules/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });
    
    try {
      // Verify rule belongs to user's office
      const existingRule = await storage.getNotificationRule(req.params.id);
      if (!existingRule || existingRule.officeId !== req.user.officeId) {
        return res.status(404).json({ error: "Notification rule not found" });
      }
      
      await storage.deleteNotificationRule(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Analytics routes
  app.get("/api/analytics/metrics", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.officeId) return res.status(400).json({ error: "No office associated" });

    try {
      const { startDate, endDate, jobType } = req.query;
      
      // Get active jobs
      const activeJobs = await storage.getJobsByOffice(req.user.officeId);
      
      // Get archived jobs
      const archivedJobs = await storage.getArchivedJobsByOffice(req.user.officeId);
      
      // Filter by date range and job type if provided
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      
      const filteredArchived = archivedJobs.filter(job => {
        const jobDate = new Date(job.archivedAt);
        const inDateRange = jobDate >= start && jobDate <= end;
        const matchesType = !jobType || jobType === 'all' || job.jobType === jobType;
        return inDateRange && matchesType;
      });
      
      const filteredActive = activeJobs.filter(job => {
        const jobDate = new Date(job.statusChangedAt || job.createdAt);
        const inDateRange = jobDate >= start && jobDate <= end;
        const matchesType = !jobType || jobType === 'all' || job.jobType === jobType;
        return inDateRange && matchesType;
      });
      
      // Calculate metrics
      const completed = filteredArchived.filter(j => j.finalStatus === 'completed').length +
                       filteredActive.filter(j => j.status === 'completed').length;
      const cancelled = filteredArchived.filter(j => j.finalStatus === 'cancelled').length +
                       filteredActive.filter(j => j.status === 'cancelled').length;
      const active = filteredActive.filter(j => j.status !== 'completed' && j.status !== 'cancelled').length;
      
      // Calculate average completion time
      const completedWithTime = filteredArchived
        .filter(j => j.finalStatus === 'completed' && j.originalCreatedAt && j.archivedAt)
        .map(j => {
          const created = new Date(j.originalCreatedAt);
          const archived = new Date(j.archivedAt);
          return (archived.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        });
      
      const avgCompletionTime = completedWithTime.length > 0
        ? (completedWithTime.reduce((a, b) => a + b, 0) / completedWithTime.length).toFixed(1)
        : null;
      
      res.json({
        active,
        completed,
        cancelled,
        avgCompletionTime,
        totalJobs: active + completed + cancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin routes
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/offices", requireAdmin, async (req, res) => {
    try {
      const offices = await storage.getAllOffices();
      res.json(offices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/offices/:id", requireAdmin, async (req, res) => {
    try {
      const officeWithMetrics = await storage.getOfficeWithMetrics(req.params.id);
      if (!officeWithMetrics) {
        return res.status(404).json({ error: "Office not found" });
      }
      res.json(officeWithMetrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/offices/:id/status", requireAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }

      const office = await storage.toggleOfficeStatus(req.params.id, enabled);
      
      await storage.createAuditLog({
        adminId: req.user!.id,
        action: enabled ? 'enable_office' : 'disable_office',
        targetType: 'office',
        targetId: req.params.id,
        metadata: { officeName: office.name, enabled }
      });

      res.json(office);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/activity", requireAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const activity = await storage.getAdminActivity(limit);
      res.json(activity);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/audit", requireAdmin, async (req, res) => {
    try {
      const auditData = insertAdminAuditLogSchema.parse({
        ...req.body,
        adminId: req.user!.id
      });
      
      const log = await storage.createAuditLog(auditData);
      res.status(201).json(log);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Error log routes (admin only)
  app.get("/api/admin/errors", requireAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const errors = getRecentErrors(limit);
      res.json(errors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/errors/stats", requireAdmin, async (req, res) => {
    try {
      const stats = getErrorStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/errors", requireAdmin, async (req, res) => {
    try {
      clearErrors();
      res.json({ message: "Error logs cleared" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Notification routes
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const notifications = await storage.getNotificationsByUser(req.user.id, {
        unreadOnly,
        limit,
        offset
      });

      res.json(notifications);
    } catch (error: any) {
      console.error("GET /api/notifications - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/notifications/unread-count", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const count = await storage.getUnreadNotificationCount(req.user.id);
      res.json({ count });
    } catch (error: any) {
      console.error("GET /api/notifications/unread-count - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      const notification = await storage.markNotificationRead(req.params.id, req.user.id);
      res.json(notification);
    } catch (error: any) {
      console.error("PATCH /api/notifications/:id/read - Error:", error.message);
      if (error.message.includes("not found") || error.message.includes("Not authorized")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.patch("/api/notifications/read-all", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      await storage.markAllNotificationsRead(req.user.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("PATCH /api/notifications/read-all - Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/notifications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

    try {
      await storage.deleteNotification(req.params.id, req.user.id);
      res.status(204).send();
    } catch (error: any) {
      console.error("DELETE /api/notifications/:id - Error:", error.message);
      if (error.message.includes("not found") || error.message.includes("Not authorized")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // SMS routes
  app.post("/api/sms/opt-in", async (req, res) => {
    try {
      const { phone, officeId } = req.body;
      
      const optInData = insertSmsOptInSchema.parse({
        phone,
        officeId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        sourceUrl: req.get('Referer')
      });
      
      const optIn = await storage.createSmsOptIn(optInData);
      res.status(201).json(optIn);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/sms/send", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const { phone, message, jobId } = req.body;
      
      // Check if patient has opted in
      const optIn = await storage.getSmsOptIn(phone, req.user.officeId!);
      if (!optIn) {
        return res.status(400).json({ error: "Patient has not opted in to SMS notifications" });
      }
      
      // Send SMS
      const result = await sendSMS(phone, message);
      
      // Log the attempt
      await storage.logSms({
        jobId: jobId || null,
        phone,
        message,
        status: result.success ? 'sent' : 'failed',
        messageSid: result.messageSid,
        errorCode: result.errorCode,
        errorMessage: result.error
      });
      
      if (result.success) {
        res.json({ success: true, messageSid: result.messageSid });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const server = createAppServer(app);
  return { server, sessionMiddleware };
}
