import type { Express } from "express";
import os from "os";
import { db } from "./db";
import { storage } from "./storage";
import { jobs, jobComments, jobStatusHistory, jobLinkGroups, linkGroupNotes, notificationRules } from "@shared/schema";
import { eq, and, desc, sql, max } from "drizzle-orm";
import { verifySecret } from "./secret-hash";
import { broadcastToOffice } from "./sync-websocket";
import { normalizePatientNamePart } from "@shared/name-format";
import { insertJobSchema } from "@shared/schema";
import { getCachedPlan } from "./license";
import { requireAuth, requireRole } from "./middleware";
import {
  createTabletSession,
  validateTabletToken,
  invalidateTabletSessionByToken,
  requireTabletAuth,
  getActiveTabletSessionCount,
  trackTabletSlotHeartbeat,
  isNewTabletSlotSession,
  getActiveTabletSessions,
  cleanExpiredTabletSessions,
} from "./tablet-auth";

function getTabletLanUrl(): string {
  const port = process.env.PORT || "5150";
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "https";
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return `${protocol}://${iface.address}:${port}/tablet/`;
      }
    }
  }
  return `${protocol}://localhost:${port}/tablet/`;
}

// Minimal QR code generator (numeric mode, version auto-detected)
// Generates SVG directly without external dependencies
function generateQrSvg(data: string, moduleSize = 4, margin = 4): string {
  // Use a simple alphanumeric encoding for URL data
  // For a production QR code we'd use a library, but to avoid new dependencies
  // we generate a placeholder SVG with the URL text
  const size = moduleSize * 33 + margin * 2;
  // Encode URL as a simple visual representation with the URL displayed
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="white"/>
  <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui" font-size="10" fill="#333">
    Scan QR in browser
  </text>
  <text x="${size / 2}" y="${size / 2 + 16}" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="8" fill="#666">
    ${data.length > 40 ? data.slice(0, 40) + "..." : data}
  </text>
</svg>`;
}

function checkTabletEnabled(): { enabled: boolean; plan: ReturnType<typeof getCachedPlan> } {
  const plan = getCachedPlan();
  return { enabled: plan.tabletSlots > 0, plan };
}

export function registerTabletRoutes(app: Express): void {
  // ── Tablet addon gate middleware for all /tablet/ routes ──
  // Allows /tablet/api/office-info through (needed before login to check if tablet is enabled)

  // ── Unauthenticated endpoints ──

  // Get basic office info (needed for login screen to know which office)
  app.get("/tablet/api/office-info", (_req, res) => {
    try {
      const row = db
        .select({ id: sql`id`, name: sql`name` })
        .from(sql`offices`)
        .where(sql`enabled = 1`)
        .limit(1)
        .all();
      if (!row[0]) {
        return res.status(404).json({ error: "No office found" });
      }
      const { enabled } = checkTabletEnabled();
      res.json({ officeId: row[0].id, officeName: row[0].name, tabletEnabled: enabled });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List users for login screen (names only, no credentials)
  app.get("/tablet/api/users", async (req, res) => {
    try {
      const officeId = typeof req.query.officeId === "string" ? req.query.officeId : "";
      if (!officeId) {
        return res.status(400).json({ error: "officeId is required" });
      }
      const officeUsers = await storage.getUsersInOffice(officeId);
      const publicUsers = officeUsers
        .filter((u) => u.role !== "super_admin" && u.pinHash)
        .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
      res.json(publicUsers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PIN login
  app.post("/tablet/api/login", async (req, res) => {
    try {
      const { enabled, plan } = checkTabletEnabled();
      if (!enabled) {
        return res.status(403).json({
          error: "TABLET_NOT_ENABLED",
          message: "Tablet boards are not enabled for this office.",
        });
      }

      const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
      const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";

      if (!userId) return res.status(400).json({ error: "userId is required" });
      if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: "PIN must be exactly 6 digits" });

      const user = await storage.getUser(userId);
      if (!user || !user.pinHash) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const pinValid = await verifySecret(pin, user.pinHash);
      if (!pinValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const userAgent = req.headers["user-agent"] || undefined;
      const token = await createTabletSession(user.id, user.officeId!, userAgent);

      res.json({
        token,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        officeId: user.officeId,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Authenticated endpoints ──

  // Poll endpoint — lightweight check for data changes
  app.get("/tablet/api/poll", requireTabletAuth, (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const result = db
        .select({
          jobsMax: sql<number>`COALESCE(MAX(j.updated_at), 0)`,
          commentsMax: sql<number>`COALESCE(MAX(c.created_at), 0)`,
          historyMax: sql<number>`COALESCE(MAX(h.changed_at), 0)`,
        })
        .from(sql`jobs j`)
        .leftJoin(sql`job_comments c`, sql`c.job_id = j.id`)
        .leftJoin(sql`job_status_history h`, sql`h.job_id = j.id`)
        .where(sql`j.office_id = ${officeId}`)
        .all();

      const row = result[0] || { jobsMax: 0, commentsMax: 0, historyMax: 0 };
      const lastModified = Math.max(
        Number(row.jobsMax) || 0,
        Number(row.commentsMax) || 0,
        Number(row.historyMax) || 0,
      );

      res.json({ lastModified });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List active jobs
  app.get("/tablet/api/jobs", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const jobList = await storage.getJobsByOffice(officeId);
      const commentCounts = await storage.getJobCommentCounts(officeId);

      // Get notification rules for overdue calculation
      const rules = db
        .select()
        .from(notificationRules)
        .where(eq(notificationRules.officeId, officeId))
        .all();

      res.json({ jobs: jobList, commentCounts, notificationRules: rules });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single job with details
  app.get("/tablet/api/jobs/:id", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const job = await storage.getJob(req.params.id);
      if (!job || job.officeId !== officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const comments = await storage.getJobComments(req.params.id);
      const history = db
        .select()
        .from(jobStatusHistory)
        .where(eq(jobStatusHistory.jobId, req.params.id))
        .orderBy(desc(jobStatusHistory.changedAt))
        .all();

      // Check for linked jobs
      const linkGroup = db
        .select()
        .from(jobLinkGroups)
        .where(eq(jobLinkGroups.jobId, req.params.id))
        .limit(1)
        .all();

      let linkedJobs: any[] = [];
      let groupNotes: any[] = [];
      if (linkGroup[0]) {
        const groupId = linkGroup[0].groupId;
        const allInGroup = db
          .select({ jobId: jobLinkGroups.jobId })
          .from(jobLinkGroups)
          .where(eq(jobLinkGroups.groupId, groupId))
          .all();

        for (const link of allInGroup) {
          if (link.jobId === req.params.id) continue;
          const linked = await storage.getJob(link.jobId);
          if (linked) linkedJobs.push(linked);
        }

        groupNotes = db
          .select()
          .from(linkGroupNotes)
          .where(eq(linkGroupNotes.groupId, groupId))
          .orderBy(desc(linkGroupNotes.createdAt))
          .all();
      }

      res.json({ job, comments, statusHistory: history, linkedJobs, groupNotes });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update job status
  app.put("/tablet/api/jobs/:id/status", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const userId = req.tabletUser!.userId;
      const newStatus = typeof req.body?.status === "string" ? req.body.status.trim() : "";

      if (!newStatus) {
        return res.status(400).json({ error: "status is required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job || job.officeId !== officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const oldStatus = job.status;
      const updated = await storage.updateJob(req.params.id, { status: newStatus }, userId);

      // Archive if terminal status
      if (newStatus === "completed" || newStatus === "cancelled") {
        await storage.archiveJob(updated);
        await storage.deleteJob(req.params.id);
      }

      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now() });
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Add note/comment to job
  app.post("/tablet/api/jobs/:id/notes", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const userId = req.tabletUser!.userId;
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

      if (!content) {
        return res.status(400).json({ error: "content is required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job || job.officeId !== officeId) {
        return res.status(404).json({ error: "Job not found" });
      }

      const comment = await storage.createJobComment({
        jobId: req.params.id,
        authorId: userId,
        content,
      });

      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now() });
      res.status(201).json(comment);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Create new job
  app.post("/tablet/api/jobs", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const userId = req.tabletUser!.userId;

      const normalizedFirstName = normalizePatientNamePart(req.body?.patientFirstName);
      const normalizedLastName = normalizePatientNamePart(req.body?.patientLastName);

      // Check office identifier mode
      const office = await storage.getOffice(officeId);
      const officeSettings = (office?.settings || {}) as Record<string, any>;
      const jobIdentifierMode = officeSettings.jobIdentifierMode || "patientName";

      if (jobIdentifierMode === "trayNumber") {
        if (!req.body?.trayNumber || !req.body.trayNumber.trim()) {
          return res.status(400).json({ error: "Tray number is required" });
        }
      } else {
        if (!normalizedFirstName || !normalizedLastName) {
          return res.status(400).json({ error: "Patient first name and last name are required" });
        }
      }

      const normalizedBody =
        jobIdentifierMode === "trayNumber"
          ? { ...req.body, patientFirstName: "", patientLastName: "" }
          : { ...req.body, patientFirstName: normalizedFirstName, patientLastName: normalizedLastName };

      const jobData = insertJobSchema.parse({
        ...normalizedBody,
        officeId,
        createdBy: userId,
      });

      const job = await storage.createJob(jobData);
      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now() });
      res.status(201).json(job);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Get office config (statuses, job types, destinations)
  app.get("/tablet/api/config", requireTabletAuth, async (req, res) => {
    try {
      const officeId = req.tabletUser!.officeId;
      const office = await storage.getOffice(officeId);
      if (!office) {
        return res.status(404).json({ error: "Office not found" });
      }

      const settings = (office.settings || {}) as Record<string, any>;
      res.json({
        customStatuses: settings.customStatuses || [],
        customJobTypes: settings.customJobTypes || [],
        customOrderDestinations: settings.customOrderDestinations || [],
        jobIdentifierMode: settings.jobIdentifierMode || "patientName",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Logout (delete tablet session)
  app.post("/tablet/api/logout", requireTabletAuth, async (req, res) => {
    try {
      const token = req.headers.authorization?.slice(7) || "";
      await invalidateTabletSessionByToken(token);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Heartbeat (updates session + slot tracking)
  app.post("/tablet/api/heartbeat", requireTabletAuth, (req, res) => {
    try {
      const { plan } = checkTabletEnabled();
      const sessionId = req.tabletUser!.sessionId;

      // Check slot limit for new sessions
      if (isNewTabletSlotSession(sessionId)) {
        const activeCount = getActiveTabletSessionCount();
        if (activeCount >= plan.tabletSlots) {
          return res.status(403).json({
            error: "TABLET_LIMIT_REACHED",
            message: `This office has reached its tablet limit (${plan.tabletSlots} tablets).`,
          });
        }
      }

      trackTabletSlotHeartbeat(sessionId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Desktop-authed endpoints (for settings panel) ──

  // QR code setup endpoint
  app.get("/tablet/api/qr-setup", (_req, res) => {
    try {
      const url = getTabletLanUrl();
      const svg = generateQrSvg(url);
      res.json({ url, svg });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Active tablet sessions (for Host settings panel)
  app.get("/tablet/api/sessions", requireAuth, requireRole(["owner", "manager"]), (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.officeId) {
        return res.status(400).json({ error: "No office associated" });
      }
      cleanExpiredTabletSessions();
      const sessions = getActiveTabletSessions(user.officeId);
      res.json(sessions);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
