import {
  users,
  offices,
  jobs,
  archivedJobs,
  joinRequests,
  accountSignupRequests,
  invitations,
  jobComments,
  commentReads,
  jobFlags,
  notificationRules,
  notifications,
  smsOptIns,
  smsLogs,
  jobStatusHistory,
  adminAuditLogs,
  phiAccessLogs,
  pinResetRequests,
  orderSheetImports,
  orderSheetWatchers,
  clientDevices,
  type User,
  type InsertUser,
  type Office,
  type InsertOffice,
  type Job,
  type InsertJob,
  type ArchivedJob,
  type JobComment,
  type InsertJobComment,
  type JobCommentWithAuthor,
  type CommentRead,
  type InsertCommentRead,
  type JobFlag,
  type InsertJobFlag,
  type NotificationRule,
  type InsertNotificationRule,
  type AccountSignupRequest,
  type InsertAccountSignupRequest,
  type Invitation,
  type InsertInvitation,
  type SmsOptIn,
  type InsertSmsOptIn,
  type AdminAuditLog,
  type InsertAdminAuditLog,
  type Notification,
  type InsertNotification,
  type PhiAccessLog,
  type InsertPhiAccessLog,
  type PinResetRequestWithUser,
  type OrderSheetImport,
  type InsertOrderSheetImport,
  type OrderSheetWatcher,
} from "@shared/schema";
import { db, getDataDir } from "./db";
import fs from "fs";
import path from "path";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { deriveLoginIdCandidates, normalizeLoginId } from "./auth-identifiers";
import { defaultOnboardingForNewOffice } from "@shared/onboarding";
import { getDefaultOfficeSettings } from "@shared/office-defaults";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByLoginId(loginId: string): Promise<User | undefined>;
  getUserByIdentifier(identifier: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;

  // Office operations
  getOffice(id: string): Promise<Office | undefined>;
  createOffice(office: InsertOffice): Promise<Office>;
  updateOffice(id: string, updates: Partial<Office>): Promise<Office>;
  getUsersInOffice(officeId: string): Promise<User[]>;

  // Job operations
  getJobsByOffice(officeId: string): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  getJobByTrayNumber(officeId: string, trayNumber: string, excludeJobId?: string): Promise<Job | undefined>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: string, updates: Partial<Job>, userId: string): Promise<Job>;
  deleteJob(id: string): Promise<void>;
  archiveJob(job: Job): Promise<ArchivedJob>;
  getArchivedJobsByOffice(officeId: string, startDate?: string, endDate?: string, name?: string): Promise<ArchivedJob[]>;
  restoreArchivedJob(id: string, newStatus?: string): Promise<Job>;

  // Job comments
  getJobComments(jobId: string): Promise<JobCommentWithAuthor[]>;
  createJobComment(comment: InsertJobComment): Promise<JobCommentWithAuthor>;
  updateJobComment(id: string, updates: Partial<JobComment>): Promise<JobCommentWithAuthor>;
  deleteJobComment(id: string): Promise<void>;

  // Comment reads
  getUnreadCommentJobIds(userId: string, officeId: string): Promise<string[]>;
  updateCommentRead(userId: string, jobId: string): Promise<CommentRead>;
  getJobCommentCounts(officeId: string): Promise<Record<string, number>>;

  // Job flags
  flagJob(userId: string, jobId: string, importantNote?: string): Promise<JobFlag>;
  unflagJob(userId: string, jobId: string): Promise<void>;
  getFlaggedJobsByOffice(officeId: string): Promise<any[]>;
  updateJobFlagImportantNote(userId: string, jobId: string, note: string): Promise<void>;
  updateJobFlagAiSummary(userId: string, jobId: string, summary: string): Promise<void>;
  getJobFlaggedBy(jobId: string): Promise<{ id: string; userId: string; firstName: string; lastName: string }[]>;

  // Join requests
  getJoinRequestsByOffice(officeId: string): Promise<any[]>;
  createJoinRequest(requesterId: string, officeId: string, message?: string): Promise<any>;
  approveJoinRequest(requestId: string, role: string): Promise<void>;
  rejectJoinRequest(requestId: string): Promise<void>;

  // Account signup requests (account created after approval)
  getAccountSignupRequestsByOffice(
    officeId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      loginId: string | null;
      firstName: string;
      lastName: string;
      requestedRole: User["role"];
      requestMessage: string | null;
      requestedByIp: string | null;
      userAgent: string | null;
      createdAt: Date;
    }>
  >;
  getPendingAccountSignupRequestByLoginId(officeId: string, loginId: string): Promise<AccountSignupRequest | undefined>;
  getPendingAccountSignupRequestByEmail(officeId: string, email: string): Promise<AccountSignupRequest | undefined>;
  createAccountSignupRequest(request: InsertAccountSignupRequest): Promise<AccountSignupRequest>;
  approveAccountSignupRequest(requestId: string, officeId: string, reviewerId: string, role: User["role"]): Promise<User>;
  rejectAccountSignupRequest(requestId: string, officeId: string, reviewerId: string): Promise<void>;

  // PIN reset requests
  getPinResetRequestsByOffice(officeId: string): Promise<PinResetRequestWithUser[]>;
  getPendingPinResetRequestByUserId(userId: string): Promise<boolean>;
  createPinResetRequest(request: { userId: string; officeId: string; newPinHash: string }): Promise<{ id: string }>;
  approvePinResetRequest(requestId: string, officeId: string, reviewerId: string): Promise<void>;
  rejectPinResetRequest(requestId: string, officeId: string, reviewerId: string): Promise<void>;

  // Invitations
  getInvitationsByOffice(officeId: string): Promise<Invitation[]>;
  getInvitationById(id: string): Promise<Invitation | undefined>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  createInvitation(invitation: InsertInvitation & { token: string; expiresAt: Date }): Promise<Invitation>;
  acceptInvitation(token: string, userId: string): Promise<void>;
  cancelInvitation(invitationId: string): Promise<void>;

  // Notification rules
  getNotificationRulesByOffice(officeId: string): Promise<NotificationRule[]>;
  getNotificationRule(id: string): Promise<NotificationRule | undefined>;
  createNotificationRule(rule: InsertNotificationRule): Promise<NotificationRule>;
  updateNotificationRule(id: string, updates: Partial<NotificationRule>): Promise<NotificationRule>;
  deleteNotificationRule(id: string): Promise<void>;

  // SMS operations
  createSmsOptIn(optIn: InsertSmsOptIn): Promise<SmsOptIn>;
  getSmsOptIn(phone: string, officeId: string): Promise<SmsOptIn | undefined>;
  logSms(log: any): Promise<void>;

  // Notification operations
  getNotificationsByUser(userId: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(notificationId: string, userId: string): Promise<Notification>;
  markAllNotificationsRead(userId: string): Promise<void>;
  deleteNotification(notificationId: string, userId: string): Promise<void>;

  // Overdue jobs
  getOverdueJobs(officeId: string): Promise<any[]>;

  // Admin operations
  getPlatformStats(): Promise<{
    totalOffices: number;
    activeOffices: number;
    totalUsers: number;
    totalJobs: number;
    activeJobs: number;
    archivedJobs: number;
    avgCompletionTime: number | null;
  }>;
  getAllOffices(): Promise<Office[]>;
  getOfficeWithMetrics(officeId: string): Promise<{
    office: Office;
    userCount: number;
    activeJobCount: number;
    archivedJobCount: number;
  }>;
  toggleOfficeStatus(officeId: string, enabled: boolean): Promise<Office>;
  createAuditLog(log: InsertAdminAuditLog): Promise<AdminAuditLog>;
  getAdminActivity(limit?: number): Promise<AdminAuditLog[]>;

  // PHI access logging for HIPAA compliance
  createPhiAccessLog(log: InsertPhiAccessLog): Promise<PhiAccessLog>;
  getPhiAccessLogs(options?: { userId?: string; officeId?: string; entityType?: string; startDate?: Date; endDate?: Date; limit?: number }): Promise<PhiAccessLog[]>;

  // Order-sheet automation ledger
  getOrderSheetImportsByOffice(officeId: string, limit?: number): Promise<OrderSheetImport[]>;
  getOrderSheetImport(id: string): Promise<OrderSheetImport | undefined>;
  getOrderSheetImportByHash(officeId: string, contentHash: string): Promise<OrderSheetImport | undefined>;
  getKnownOrderSheetHashes(officeId: string, hashes: string[]): Promise<string[]>;
  createOrderSheetImport(record: InsertOrderSheetImport): Promise<OrderSheetImport>;
  updateOrderSheetImport(id: string, updates: Partial<OrderSheetImport>): Promise<OrderSheetImport>;
  saveOrderSheetAttachment(importId: string, jpegBuffer: Buffer, pageCount: number): Promise<OrderSheetImport>;
  getOrderSheetImportByJobOrderId(officeId: string, jobOrderId: string): Promise<OrderSheetImport | undefined>;
  resolveOrderSheetAttachmentPath(record: OrderSheetImport): string | null;

  // Order-sheet watcher presence (heartbeats from each watching computer)
  upsertOrderSheetWatcher(record: {
    deviceId: string;
    officeId: string;
    deviceLabel?: string | null;
    folderPath?: string | null;
    enabled: boolean;
    state: string;
    error?: string | null;
  }): Promise<OrderSheetWatcher>;
  getOrderSheetWatchersByOffice(officeId: string): Promise<Array<OrderSheetWatcher & { customName: string | null }>>;
  deleteOrderSheetWatcher(officeId: string, deviceId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return undefined;
    const [user] = await db.select().from(users).where(eq(users.email, normalized));
    return user || undefined;
  }

  async getUserByLoginId(loginId: string): Promise<User | undefined> {
    const normalized = normalizeLoginId(loginId);
    if (!normalized) return undefined;
    const [user] = await db.select().from(users).where(eq(users.loginId, normalized));
    return user || undefined;
  }

  async getUserByIdentifier(identifier: string): Promise<User | undefined> {
    const normalized = String(identifier || "").trim().toLowerCase();
    if (!normalized) return undefined;

    const byLoginId = await this.getUserByLoginId(normalized);
    if (byLoginId) return byLoginId;

    return this.getUserByEmail(normalized);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const normalizedLoginId = insertUser.loginId ? normalizeLoginId(String(insertUser.loginId)) : null;
    const normalizedEmail = String(insertUser.email || "").trim().toLowerCase();
    const [user] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        ...insertUser,
        email: normalizedEmail,
        loginId: normalizedLoginId || null,
      })
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const normalizedUpdates: Record<string, any> = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "email")) {
      normalizedUpdates.email = String(normalizedUpdates.email || "").trim().toLowerCase();
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "loginId")) {
      const nextLoginId = normalizedUpdates.loginId;
      normalizedUpdates.loginId = nextLoginId ? normalizeLoginId(String(nextLoginId)) : null;
    }

    const [user] = await db
      .update(users)
      .set({ ...normalizedUpdates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getOffice(id: string): Promise<Office | undefined> {
    const [office] = await db.select().from(offices).where(eq(offices.id, id));
    return office || undefined;
  }

  async createOffice(insertOffice: InsertOffice): Promise<Office> {
    const defaultSettings = getDefaultOfficeSettings();

    const [office] = await db
      .insert(offices)
      .values({ id: randomUUID(), ...insertOffice, settings: defaultSettings })
      .returning();
    return office;
  }

  async updateOffice(id: string, updates: Partial<Office>): Promise<Office> {
    // Merge `settings` JSON instead of replacing it. Without this, callers
    // that send a partial settings object would silently drop unknown keys
    // (e.g. the `onboarding` block written by the setup wizard, or any
    // future field added in a later release).
    const finalUpdates: Record<string, any> = { ...updates, updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(updates, "settings")) {
      const incoming = updates.settings;
      const isObject = (v: unknown): v is Record<string, any> =>
        !!v && typeof v === "object" && !Array.isArray(v);
      if (isObject(incoming)) {
        const [existing] = await db
          .select({ settings: offices.settings })
          .from(offices)
          .where(eq(offices.id, id));
        const existingSettings = isObject(existing?.settings) ? existing.settings : {};
        finalUpdates.settings = { ...existingSettings, ...incoming };
      }
    }

    const [office] = await db
      .update(offices)
      .set(finalUpdates)
      .where(eq(offices.id, id))
      .returning();
    return office;
  }

  async getUsersInOffice(officeId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.officeId, officeId));
  }

  async getJobsByOffice(officeId: string): Promise<Job[]> {
    return db
      .select()
      .from(jobs)
      .where(eq(jobs.officeId, officeId))
      .orderBy(desc(jobs.createdAt));
  }

  async getJob(id: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async getJobByTrayNumber(officeId: string, trayNumber: string, excludeJobId?: string): Promise<Job | undefined> {
    const conditions = [
      eq(jobs.officeId, officeId),
      eq(jobs.trayNumber, trayNumber)
    ];
    
    if (excludeJobId) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(and(...conditions, ne(jobs.id, excludeJobId)));
      return job || undefined;
    }
    
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(...conditions));
    return job || undefined;
  }

  async createJob(insertJob: InsertJob): Promise<Job> {
    if (!insertJob.createdBy) {
      throw new Error("createdBy is required to create a job");
    }

    const providedId = typeof (insertJob as any).id === "string" ? (insertJob as any).id.trim() : "";
    if (providedId) {
      const existing = await this.getJob(providedId);
      if (existing) return existing;
    }

    // Helper to extract order number from orderId (handles any digit length)
    const extractOrderNum = (orderId: string | null): number => {
      if (!orderId) return 0;
      const parts = orderId.split('-');
      const numStr = parts[parts.length - 1]; // Get last segment after final dash
      const num = parseInt(numStr, 10);
      return isNaN(num) ? 0 : num;
    };

    // Retry loop to handle concurrent job creation race conditions
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Generate order ID by finding max order number for today across both active and archived jobs
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const orderIdPrefix = `ORD-${today}-`;
        
        const maxActiveResult = await db
          .select({ orderId: jobs.orderId })
          .from(jobs)
          .where(sql`${jobs.orderId} LIKE ${orderIdPrefix + '%'}`)
          .orderBy(desc(jobs.orderId))
          .limit(1);
        
        const maxArchivedResult = await db
          .select({ orderId: archivedJobs.orderId })
          .from(archivedJobs)
          .where(sql`${archivedJobs.orderId} LIKE ${orderIdPrefix + '%'}`)
          .orderBy(desc(archivedJobs.orderId))
          .limit(1);
        
        // Extract order numbers and find the max
        const maxActiveNum = extractOrderNum(maxActiveResult[0]?.orderId || null);
        const maxArchivedNum = extractOrderNum(maxArchivedResult[0]?.orderId || null);
        const maxOrderNum = Math.max(maxActiveNum, maxArchivedNum);
        
        const orderNumber = String(maxOrderNum + 1).padStart(4, '0');
        const orderId = `ORD-${today}-${orderNumber}`;

        const [job] = await db
          .insert(jobs)
          .values({ 
            id: providedId || randomUUID(),
            ...insertJob, 
            orderId,
            statusChangedAt: (insertJob as any).statusChangedAt || new Date()
          })
          .returning();
        
        // Log initial status
        await db.insert(jobStatusHistory).values({
          id: randomUUID(),
          jobId: job.id,
          oldStatus: null,
          newStatus: job.status,
          changedBy: job.createdBy!,
        });

        return job;
      } catch (error: any) {
        // If it's a unique constraint violation on orderId, retry
        const msg = String(error?.message || "");
        if (
          (msg.includes("jobs_order_id_unique") || msg.includes("UNIQUE constraint failed: jobs.order_id")) &&
          attempt < maxRetries - 1
        ) {
          // Small random delay to reduce collision probability
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          continue;
        }
        throw error;
      }
    }
    
    throw new Error('Failed to create job after multiple attempts due to order ID conflicts');
  }

  async updateJob(id: string, updates: Partial<Job>, userId: string): Promise<Job> {
    const oldJob = await this.getJob(id);
    if (!oldJob) throw new Error('Job not found');

    const [job] = await db
      .update(jobs)
      .set({ 
        ...updates, 
        updatedAt: new Date(),
        statusChangedAt: updates.status ? new Date() : oldJob.statusChangedAt
      })
      .where(eq(jobs.id, id))
      .returning();

    // Log status change if status was updated
    if (updates.status && updates.status !== oldJob.status) {
      await db.insert(jobStatusHistory).values({
        id: randomUUID(),
        jobId: job.id,
        oldStatus: oldJob.status,
        newStatus: job.status,
        changedBy: userId
      });
    }

    return job;
  }

  async deleteJob(id: string): Promise<void> {
    await db.delete(jobs).where(eq(jobs.id, id));
  }

  async archiveJob(job: Job): Promise<ArchivedJob> {
    // Query job_status_history to find the previous status before completion/cancellation
    const statusHistory = await db
      .select()
      .from(jobStatusHistory)
      .where(
        and(
          eq(jobStatusHistory.jobId, job.id),
          sql`${jobStatusHistory.newStatus} IN ('completed', 'cancelled')`
        )
      )
      .orderBy(desc(jobStatusHistory.changedAt))
      .limit(1);

    const previousStatus = statusHistory[0]?.oldStatus || null;

    const [archived] = await db
      .insert(archivedJobs)
      .values({
        id: randomUUID(),
        orderId: job.orderId,
        patientFirstName: job.patientFirstName,
        patientLastName: job.patientLastName,
        // In trayNumber identifier mode the patient name fields are blank
        // by design — the tray IS the identifier, so dropping it here
        // left archived rows with no identifier at all.
        trayNumber: job.trayNumber,
        phone: job.phone,
        jobType: job.jobType,
        finalStatus: job.status,
        previousStatus: previousStatus,
        orderDestination: job.orderDestination,
        officeId: job.officeId,
        createdBy: job.createdBy,
        originalCreatedAt: job.createdAt,
        customColumnValues: job.customColumnValues,
        isRedoJob: job.isRedoJob,
        originalJobId: job.originalJobId,
        notes: job.notes,
        source: job.source,
      })
      .returning();
    return archived;
  }

  async getArchivedJobsByOffice(
    officeId: string, 
    startDate?: string, 
    endDate?: string, 
    name?: string
  ): Promise<ArchivedJob[]> {
    const conditions = [eq(archivedJobs.officeId, officeId)];
    
    // Add date range filtering
    if (startDate) {
      conditions.push(gte(archivedJobs.archivedAt, new Date(startDate)));
    }
    if (endDate) {
      // Add 1 day to include the entire end date
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      conditions.push(lte(archivedJobs.archivedAt, endDateTime));
    }
    
    // Identifier filtering — matches patient name OR tray number so the
    // search box works in both office identifier modes (tray-mode rows
    // have blank names and a tray as their only identifier).
    if (name && name.trim()) {
      const pattern = '%' + name.trim() + '%';
      conditions.push(
        sql`(LOWER(${archivedJobs.patientFirstName} || ' ' || ${archivedJobs.patientLastName}) LIKE LOWER(${pattern})
             OR LOWER(COALESCE(${archivedJobs.trayNumber}, '')) LIKE LOWER(${pattern}))`
      );
    }
    
    return db
      .select()
      .from(archivedJobs)
      .where(and(...conditions))
      .orderBy(desc(archivedJobs.archivedAt));
  }

  async restoreArchivedJob(id: string, newStatus?: string): Promise<Job> {
    const [archived] = await db
      .select()
      .from(archivedJobs)
      .where(eq(archivedJobs.id, id));
    
    if (!archived) throw new Error('Archived job not found');

    // Use provided status, or previousStatus from archive, or default to 'job_created'
    const restoreStatus = newStatus || archived.previousStatus || 'job_created';

    // Create new job from archived data
    const [restoredJob] = await db
      .insert(jobs)
      .values({
        id: randomUUID(),
        orderId: archived.orderId,
        patientFirstName: archived.patientFirstName,
        patientLastName: archived.patientLastName,
        // Round-trip the tray identifier and provenance marker — without
        // these, restoring stripped the only identifier in trayNumber
        // mode and dropped the "Auto" badge on automation-created jobs.
        trayNumber: archived.trayNumber,
        source: archived.source,
        phone: archived.phone,
        jobType: archived.jobType,
        status: restoreStatus as any,
        orderDestination: archived.orderDestination,
        officeId: archived.officeId,
        createdBy: archived.createdBy,
        customColumnValues: archived.customColumnValues,
        isRedoJob: archived.isRedoJob,
        originalJobId: archived.originalJobId,
        notes: archived.notes ? `${archived.notes}\n[Restored from archive]` : '[Restored from archive]',
        statusChangedAt: new Date()
      })
      .returning();

    // Remove from archive
    await db.delete(archivedJobs).where(eq(archivedJobs.id, id));

    return restoredJob;
  }

  async getJobComments(jobId: string): Promise<JobCommentWithAuthor[]> {
    const comments = await db
      .select({
        id: jobComments.id,
        jobId: jobComments.jobId,
        authorId: jobComments.authorId,
        content: jobComments.content,
        isOverdueComment: jobComments.isOverdueComment,
        createdAt: jobComments.createdAt,
        author: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        }
      })
      .from(jobComments)
      .innerJoin(users, eq(jobComments.authorId, users.id))
      .where(eq(jobComments.jobId, jobId))
      .orderBy(asc(jobComments.createdAt));
    
    return comments;
  }

  async createJobComment(comment: InsertJobComment): Promise<JobCommentWithAuthor> {
    const providedId = typeof (comment as any).id === "string" ? (comment as any).id.trim() : "";
    if (providedId) {
      const existing = await db
        .select({
          id: jobComments.id,
          jobId: jobComments.jobId,
          authorId: jobComments.authorId,
          content: jobComments.content,
          isOverdueComment: jobComments.isOverdueComment,
          createdAt: jobComments.createdAt,
          author: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(jobComments)
        .innerJoin(users, eq(jobComments.authorId, users.id))
        .where(eq(jobComments.id, providedId))
        .limit(1);

      if (existing[0]) {
        return existing[0];
      }
    }

    const [newComment] = await db
      .insert(jobComments)
      .values({ id: providedId || randomUUID(), ...comment })
      .returning();
    
    // Fetch the author information
    const [author] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, newComment.authorId));
    
    return {
      ...newComment,
      author
    };
  }

  async updateJobComment(id: string, updates: Partial<JobComment>): Promise<JobCommentWithAuthor> {
    const [comment] = await db
      .update(jobComments)
      .set(updates)
      .where(eq(jobComments.id, id))
      .returning();
    
    // Fetch the author information
    const [author] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, comment.authorId));
    
    return {
      ...comment,
      author
    };
  }

  async deleteJobComment(id: string): Promise<void> {
    await db.delete(jobComments).where(eq(jobComments.id, id));
  }

  async getUnreadCommentJobIds(userId: string, officeId: string): Promise<string[]> {
    const results = await db
      .selectDistinct({ jobId: jobs.id })
      .from(jobs)
      .innerJoin(jobComments, eq(jobs.id, jobComments.jobId))
      .leftJoin(
        commentReads,
        and(
          eq(jobs.id, commentReads.jobId),
          eq(commentReads.userId, userId)
        )
      )
      .where(
        and(
          eq(jobs.officeId, officeId),
          ne(jobComments.authorId, userId),
          sql`(${commentReads.lastReadAt} IS NULL OR ${jobComments.createdAt} > ${commentReads.lastReadAt})`
        )
      );

    return results.map(r => r.jobId);
  }

  async updateCommentRead(userId: string, jobId: string): Promise<CommentRead> {
    // Check if a record exists
    const [existing] = await db
      .select()
      .from(commentReads)
      .where(and(
        eq(commentReads.userId, userId),
        eq(commentReads.jobId, jobId)
      ));

    if (existing) {
      // Update existing record
      const [updated] = await db
        .update(commentReads)
        .set({ lastReadAt: new Date() })
        .where(and(
          eq(commentReads.userId, userId),
          eq(commentReads.jobId, jobId)
        ))
        .returning();
      return updated;
    } else {
      // Create new record
      const [created] = await db
        .insert(commentReads)
        .values({
          id: randomUUID(),
          userId,
          jobId,
          lastReadAt: new Date()
        })
        .returning();
      return created;
    }
  }

  async getJobCommentCounts(officeId: string): Promise<Record<string, number>> {
    const counts = await db
      .select({
        jobId: jobComments.jobId,
        count: sql<number>`count(*)`
      })
      .from(jobComments)
      .innerJoin(jobs, eq(jobs.id, jobComments.jobId))
      .where(eq(jobs.officeId, officeId))
      .groupBy(jobComments.jobId);
    
    return counts.reduce((acc, { jobId, count }) => {
      acc[jobId] = count;
      return acc;
    }, {} as Record<string, number>);
  }

  async flagJob(userId: string, jobId: string, importantNote?: string): Promise<JobFlag> {
    const inserted = await db
      .insert(jobFlags)
      .values({ 
        id: randomUUID(),
        userId, 
        jobId,
        importantNote: importantNote?.trim() || null,
        importantNoteUpdatedAt: importantNote?.trim() ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return inserted[0];

    const [existing] = await db
      .select()
      .from(jobFlags)
      .where(and(eq(jobFlags.userId, userId), eq(jobFlags.jobId, jobId)));

    if (!existing) {
      throw new Error("Failed to flag job");
    }

    return existing;
  }

  async unflagJob(userId: string, jobId: string): Promise<void> {
    await db
      .delete(jobFlags)
      .where(and(
        eq(jobFlags.userId, userId),
        eq(jobFlags.jobId, jobId)
      ));
  }

  async getFlaggedJobsByOffice(officeId: string): Promise<any[]> {
    const flaggedJobs = await db
      .select({
        id: jobs.id,
        orderId: jobs.orderId,
        patientFirstName: jobs.patientFirstName,
        patientLastName: jobs.patientLastName,
        phone: jobs.phone,
        jobType: jobs.jobType,
        status: jobs.status,
        orderDestination: jobs.orderDestination,
        officeId: jobs.officeId,
        createdBy: jobs.createdBy,
        statusChangedAt: jobs.statusChangedAt,
        customColumnValues: jobs.customColumnValues,
        isRedoJob: jobs.isRedoJob,
        originalJobId: jobs.originalJobId,
        notes: jobs.notes,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        importantNote: jobFlags.importantNote,
        importantNoteUpdatedAt: jobFlags.importantNoteUpdatedAt,
        aiSummary: jobFlags.summary,
        aiSummaryGeneratedAt: jobFlags.summaryGeneratedAt,
        flaggedBy: {
          id: jobFlags.userId,
          firstName: users.firstName,
          lastName: users.lastName,
        }
      })
      .from(jobs)
      .innerJoin(jobFlags, eq(jobFlags.jobId, jobs.id))
      .innerJoin(users, eq(users.id, jobFlags.userId))
      .where(eq(jobs.officeId, officeId))
      .orderBy(desc(jobFlags.createdAt));

    if (flaggedJobs.length === 0) return flaggedJobs;

    // Fetch comments + status history for these jobs in two parallel
    // queries, then merge them into a single "recent activity" feed
    // (last 3 of either kind) per job. We also keep a totalCommentCount
    // so the comments button can show its number.
    const RECENT_LIMIT_PER_JOB = 3;
    const flaggedJobIds = flaggedJobs.map((j) => j.id);

    const [commentsRaw, statusChangesRaw] = await Promise.all([
      db
        .select({
          id: jobComments.id,
          jobId: jobComments.jobId,
          authorId: jobComments.authorId,
          content: jobComments.content,
          isOverdueComment: jobComments.isOverdueComment,
          createdAt: jobComments.createdAt,
          author: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(jobComments)
        .innerJoin(users, eq(users.id, jobComments.authorId))
        .where(inArray(jobComments.jobId, flaggedJobIds))
        .orderBy(desc(jobComments.createdAt)),
      db
        .select({
          id: jobStatusHistory.id,
          jobId: jobStatusHistory.jobId,
          oldStatus: jobStatusHistory.oldStatus,
          newStatus: jobStatusHistory.newStatus,
          changedBy: jobStatusHistory.changedBy,
          changedAt: jobStatusHistory.changedAt,
          actor: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(jobStatusHistory)
        .innerJoin(users, eq(users.id, jobStatusHistory.changedBy))
        .where(inArray(jobStatusHistory.jobId, flaggedJobIds))
        .orderBy(desc(jobStatusHistory.changedAt)),
    ]);

    type ActivityItem =
      | {
          kind: "comment";
          jobId: string;
          at: number;
          comment: typeof commentsRaw[number];
        }
      | {
          kind: "status";
          jobId: string;
          at: number;
          status: typeof statusChangesRaw[number];
        };

    const activityByJob = new Map<string, ActivityItem[]>();
    const totalByJob = new Map<string, number>();
    const pushActivity = (jobId: string, item: ActivityItem) => {
      const bucket = activityByJob.get(jobId) || [];
      bucket.push(item);
      activityByJob.set(jobId, bucket);
    };
    for (const c of commentsRaw) {
      totalByJob.set(c.jobId, (totalByJob.get(c.jobId) || 0) + 1);
      pushActivity(c.jobId, {
        kind: "comment",
        jobId: c.jobId,
        at: c.createdAt instanceof Date ? c.createdAt.getTime() : Number(c.createdAt) || 0,
        comment: c,
      });
    }
    for (const s of statusChangesRaw) {
      pushActivity(s.jobId, {
        kind: "status",
        jobId: s.jobId,
        at: s.changedAt instanceof Date ? s.changedAt.getTime() : Number(s.changedAt) || 0,
        status: s,
      });
    }

    return flaggedJobs.map((job) => {
      const merged = (activityByJob.get(job.id) || [])
        .sort((a, b) => b.at - a.at)
        .slice(0, RECENT_LIMIT_PER_JOB);
      return {
        ...job,
        // Unified feed — most recent N of either kind. Each item is
        // tagged with its kind so the client renders comments and
        // status changes with their own visual treatment.
        recentActivity: merged,
        commentCount: totalByJob.get(job.id) || 0,
      };
    });
  }

  async updateJobFlagImportantNote(userId: string, jobId: string, note: string): Promise<void> {
    const trimmed = String(note || "").trim();
    await db
      .update(jobFlags)
      .set({ 
        importantNote: trimmed || null,
        importantNoteUpdatedAt: trimmed ? new Date() : null,
      })
      .where(and(
        eq(jobFlags.userId, userId),
        eq(jobFlags.jobId, jobId)
      ));
  }

  async updateJobFlagAiSummary(userId: string, jobId: string, summary: string): Promise<void> {
    await db
      .update(jobFlags)
      .set({
        summary,
        summaryGeneratedAt: new Date(),
      })
      .where(and(
        eq(jobFlags.userId, userId),
        eq(jobFlags.jobId, jobId)
      ));
  }

  async getJobFlaggedBy(jobId: string): Promise<{ id: string; userId: string; firstName: string; lastName: string }[]> {
    const flaggedBy = await db
      .select({
        id: jobFlags.id,
        userId: jobFlags.userId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(jobFlags)
      .innerJoin(users, eq(users.id, jobFlags.userId))
      .where(eq(jobFlags.jobId, jobId));
    
    return flaggedBy;
  }

  async getJoinRequestsByOffice(officeId: string): Promise<any[]> {
    return db
      .select({
        id: joinRequests.id,
        message: joinRequests.message,
        status: joinRequests.status,
        createdAt: joinRequests.createdAt,
        requester: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email
        }
      })
      .from(joinRequests)
      .innerJoin(users, eq(joinRequests.requesterId, users.id))
      .where(and(
        eq(joinRequests.officeId, officeId),
        eq(joinRequests.status, 'pending')
      ))
      .orderBy(desc(joinRequests.createdAt));
  }

  async createJoinRequest(requesterId: string, officeId: string, message?: string): Promise<any> {
    const [request] = await db
      .insert(joinRequests)
      .values({
        id: randomUUID(),
        requesterId,
        officeId,
        message,
        status: 'pending'
      })
      .returning();
    return request;
  }

  async approveJoinRequest(requestId: string, role: string): Promise<void> {
    // Get the request
    const [request] = await db
      .select()
      .from(joinRequests)
      .where(eq(joinRequests.id, requestId));
    
    if (!request) throw new Error('Join request not found');

    // Update user with office and role
    await db
      .update(users)
      .set({
        officeId: request.officeId,
        role: role as any,
        updatedAt: new Date()
      })
      .where(eq(users.id, request.requesterId));

    // Mark request as approved
    await db
      .update(joinRequests)
      .set({ status: 'approved' })
      .where(eq(joinRequests.id, requestId));
  }

  async rejectJoinRequest(requestId: string): Promise<void> {
    await db.delete(joinRequests).where(eq(joinRequests.id, requestId));
  }

  async getAccountSignupRequestsByOffice(
    officeId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      loginId: string | null;
      firstName: string;
      lastName: string;
      requestedRole: User["role"];
      requestMessage: string | null;
      requestedByIp: string | null;
      userAgent: string | null;
      createdAt: Date;
    }>
  > {
    return db
      .select({
        id: accountSignupRequests.id,
        email: accountSignupRequests.email,
        loginId: accountSignupRequests.loginId,
        firstName: accountSignupRequests.firstName,
        lastName: accountSignupRequests.lastName,
        requestedRole: accountSignupRequests.requestedRole,
        requestMessage: accountSignupRequests.requestMessage,
        requestedByIp: accountSignupRequests.requestedByIp,
        userAgent: accountSignupRequests.userAgent,
        createdAt: accountSignupRequests.createdAt,
      })
      .from(accountSignupRequests)
      .where(
        and(
          eq(accountSignupRequests.officeId, officeId),
          eq(accountSignupRequests.status, "pending"),
        ),
      )
      .orderBy(desc(accountSignupRequests.createdAt));
  }

  async getPendingAccountSignupRequestByLoginId(
    officeId: string,
    loginId: string,
  ): Promise<AccountSignupRequest | undefined> {
    const normalized = normalizeLoginId(loginId);
    if (!normalized) return undefined;

    const [request] = await db
      .select()
      .from(accountSignupRequests)
      .where(
        and(
          eq(accountSignupRequests.officeId, officeId),
          eq(accountSignupRequests.loginId, normalized),
          eq(accountSignupRequests.status, "pending"),
        ),
      )
      .limit(1);
    return request || undefined;
  }

  async getPendingAccountSignupRequestByEmail(
    officeId: string,
    email: string,
  ): Promise<AccountSignupRequest | undefined> {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return undefined;

    const [request] = await db
      .select()
      .from(accountSignupRequests)
      .where(
        and(
          eq(accountSignupRequests.officeId, officeId),
          eq(accountSignupRequests.email, normalized),
          eq(accountSignupRequests.status, "pending"),
        ),
      )
      .limit(1);
    return request || undefined;
  }

  async createAccountSignupRequest(request: InsertAccountSignupRequest): Promise<AccountSignupRequest> {
    const normalizedEmail = String(request.email || "").trim().toLowerCase();
    const normalizedLoginId = request.loginId ? normalizeLoginId(String(request.loginId)) : null;
    const [created] = await db
      .insert(accountSignupRequests)
      .values({
        id: randomUUID(),
        ...request,
        email: normalizedEmail,
        loginId: normalizedLoginId || null,
      })
      .returning();
    return created;
  }

  async approveAccountSignupRequest(
    requestId: string,
    officeId: string,
    reviewerId: string,
    role: User["role"],
  ): Promise<User> {
    // better-sqlite3 transactions must be synchronous (no async/await).
    // Use .all()/.get()/.run() for explicit synchronous execution.
    return db.transaction((tx) => {
      const requests = tx
        .select()
        .from(accountSignupRequests)
        .where(
          and(
            eq(accountSignupRequests.id, requestId),
            eq(accountSignupRequests.officeId, officeId),
            eq(accountSignupRequests.status, "pending"),
          ),
        )
        .limit(1)
        .all();
      const request = requests[0];

      if (!request) throw new Error("Account request not found");

      const existingUsers = tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, request.email))
        .limit(1)
        .all();
      if (existingUsers.length > 0) {
        throw new Error("An account with this email already exists.");
      }

      const normalizedRequestedLoginId = normalizeLoginId(String(request.loginId || ""));
      let loginIdToAssign = normalizedRequestedLoginId;
      if (!loginIdToAssign) {
        const candidates = deriveLoginIdCandidates({
          email: request.email,
          firstName: request.firstName,
          lastName: request.lastName,
          id: request.id,
        });

        const existingRows = tx
          .select({ loginId: users.loginId })
          .from(users)
          .where(eq(users.officeId, request.officeId))
          .all();
        const used = new Set(
          existingRows
            .map((row: { loginId: string | null }) => normalizeLoginId(String(row.loginId || "")))
            .filter((value: string) => Boolean(value)),
        );

        for (const candidate of candidates) {
          if (!used.has(candidate)) {
            loginIdToAssign = candidate;
            break;
          }
        }

        if (!loginIdToAssign) {
          loginIdToAssign = `user-${request.id.slice(0, 8).toLowerCase()}`;
        }
      }

      const existingLoginUsers = tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.loginId, loginIdToAssign))
        .limit(1)
        .all();
      if (existingLoginUsers.length > 0) {
        throw new Error("An account with this Login ID already exists.");
      }

      const createdUsers = tx
        .insert(users)
        .values({
          id: randomUUID(),
          email: request.email,
          loginId: loginIdToAssign,
          password: request.passwordHash,
          pinHash: request.pinHash || null,
          firstName: request.firstName,
          lastName: request.lastName,
          role,
          officeId: request.officeId,
        })
        .returning()
        .all();
      const user = createdUsers[0];

      tx
        .update(accountSignupRequests)
        .set({
          status: "approved",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          requestedRole: role,
          loginId: loginIdToAssign,
          // Prevent long-term duplicate credential material in request history.
          passwordHash: "",
          pinHash: "",
        })
        .where(eq(accountSignupRequests.id, requestId))
        .run();

      return user;
    });
  }

  async rejectAccountSignupRequest(requestId: string, officeId: string, reviewerId: string): Promise<void> {
    const result = await db
      .update(accountSignupRequests)
      .set({
        status: "rejected",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        // Prevent long-term duplicate credential material in request history.
        passwordHash: "",
        pinHash: "",
      })
      .where(
        and(
          eq(accountSignupRequests.id, requestId),
          eq(accountSignupRequests.officeId, officeId),
          eq(accountSignupRequests.status, "pending"),
        ),
      )
      .returning({ id: accountSignupRequests.id });

    if (result.length === 0) {
      throw new Error("Account request not found");
    }
  }

  async getPinResetRequestsByOffice(officeId: string): Promise<PinResetRequestWithUser[]> {
    const rows = await db
      .select({
        id: pinResetRequests.id,
        userId: pinResetRequests.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        loginId: users.loginId,
        status: pinResetRequests.status,
        createdAt: pinResetRequests.createdAt,
      })
      .from(pinResetRequests)
      .innerJoin(users, eq(pinResetRequests.userId, users.id))
      .where(
        and(
          eq(pinResetRequests.officeId, officeId),
          eq(pinResetRequests.status, "pending"),
        ),
      )
      .orderBy(desc(pinResetRequests.createdAt));
    return rows;
  }

  async getPendingPinResetRequestByUserId(userId: string): Promise<boolean> {
    const rows = await db
      .select({ id: pinResetRequests.id })
      .from(pinResetRequests)
      .where(
        and(
          eq(pinResetRequests.userId, userId),
          eq(pinResetRequests.status, "pending"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async createPinResetRequest(request: { userId: string; officeId: string; newPinHash: string }): Promise<{ id: string }> {
    const [row] = await db
      .insert(pinResetRequests)
      .values({
        id: randomUUID(),
        userId: request.userId,
        officeId: request.officeId,
        newPinHash: request.newPinHash,
        status: "pending",
      })
      .returning({ id: pinResetRequests.id });
    return row;
  }

  async approvePinResetRequest(requestId: string, officeId: string, reviewerId: string): Promise<void> {
    // Synchronous transaction (better-sqlite3) — same pattern as approveAccountSignupRequest.
    db.transaction((tx) => {
      const requests = tx
        .select()
        .from(pinResetRequests)
        .where(
          and(
            eq(pinResetRequests.id, requestId),
            eq(pinResetRequests.officeId, officeId),
            eq(pinResetRequests.status, "pending"),
          ),
        )
        .limit(1)
        .all();
      const request = requests[0];
      if (!request) throw new Error("PIN reset request not found");

      // Update the user's PIN hash.
      tx
        .update(users)
        .set({ pinHash: request.newPinHash, updatedAt: new Date() })
        .where(eq(users.id, request.userId))
        .run();

      // Mark request as approved and scrub stored hash.
      tx
        .update(pinResetRequests)
        .set({
          status: "approved",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          newPinHash: "",
        })
        .where(eq(pinResetRequests.id, requestId))
        .run();
    });
  }

  async rejectPinResetRequest(requestId: string, officeId: string, reviewerId: string): Promise<void> {
    const result = await db
      .update(pinResetRequests)
      .set({
        status: "rejected",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        newPinHash: "",
      })
      .where(
        and(
          eq(pinResetRequests.id, requestId),
          eq(pinResetRequests.officeId, officeId),
          eq(pinResetRequests.status, "pending"),
        ),
      )
      .returning({ id: pinResetRequests.id });

    if (result.length === 0) {
      throw new Error("PIN reset request not found");
    }
  }

  async getInvitationsByOffice(officeId: string): Promise<Invitation[]> {
    return db
      .select()
      .from(invitations)
      .where(and(
        eq(invitations.officeId, officeId),
        eq(invitations.status, 'pending')
      ))
      .orderBy(desc(invitations.createdAt));
  }

  async getInvitationById(id: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id));
    return invitation || undefined;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token));
    return invitation || undefined;
  }

  async createInvitation(invitation: InsertInvitation & { token: string; expiresAt: Date }): Promise<Invitation> {
    const [newInvitation] = await db
      .insert(invitations)
      .values({ id: randomUUID(), ...invitation })
      .returning();
    return newInvitation;
  }

  async acceptInvitation(token: string, userId: string): Promise<void> {
    const invitation = await this.getInvitationByToken(token);
    if (!invitation) throw new Error('Invitation not found');
    if (invitation.status !== 'pending') throw new Error('Invitation is no longer valid');
    if (new Date() > new Date(invitation.expiresAt)) throw new Error('Invitation has expired');

    await db
      .update(users)
      .set({
        officeId: invitation.officeId,
        role: invitation.role,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db
      .update(invitations)
      .set({ status: 'accepted' })
      .where(eq(invitations.id, invitation.id));
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    await db
      .update(invitations)
      .set({ status: 'cancelled' })
      .where(eq(invitations.id, invitationId));
  }

  async getNotificationRulesByOffice(officeId: string): Promise<NotificationRule[]> {
    return db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.officeId, officeId))
      .orderBy(asc(notificationRules.status));
  }

  async getNotificationRule(id: string): Promise<NotificationRule | undefined> {
    const [rule] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, id))
      .limit(1);
    return rule;
  }

  async createNotificationRule(rule: InsertNotificationRule): Promise<NotificationRule> {
    const [newRule] = await db
      .insert(notificationRules)
      .values({ id: randomUUID(), ...rule } as any)
      .returning();
    return newRule;
  }

  async updateNotificationRule(id: string, updates: Partial<NotificationRule>): Promise<NotificationRule> {
    const [rule] = await db
      .update(notificationRules)
      .set(updates)
      .where(eq(notificationRules.id, id))
      .returning();
    return rule;
  }

  async deleteNotificationRule(id: string): Promise<void> {
    await db.delete(notificationRules).where(eq(notificationRules.id, id));
  }

  async createSmsOptIn(optIn: InsertSmsOptIn): Promise<SmsOptIn> {
    const [newOptIn] = await db
      .insert(smsOptIns)
      .values({ id: randomUUID(), ...optIn })
      .returning();
    return newOptIn;
  }

  async getSmsOptIn(phone: string, officeId: string): Promise<SmsOptIn | undefined> {
    const [optIn] = await db
      .select()
      .from(smsOptIns)
      .where(and(
        eq(smsOptIns.phone, phone),
        eq(smsOptIns.officeId, officeId)
      ));
    return optIn || undefined;
  }

  async logSms(log: any): Promise<void> {
    const row = {
      id: randomUUID(),
      sentAt: new Date(),
      ...log,
    };

    await db.insert(smsLogs).values(row);
  }

  async getNotificationsByUser(userId: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        actorId: notifications.actorId,
        type: notifications.type,
        jobId: notifications.jobId,
        title: notifications.title,
        message: notifications.message,
        metadata: notifications.metadata,
        linkTo: notifications.linkTo,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actor: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
        job: {
          id: jobs.id,
          orderId: jobs.orderId,
          patientLastName: jobs.patientLastName,
        }
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorId, users.id))
      .leftJoin(jobs, eq(notifications.jobId, jobs.id))
      .where(and(
        eq(notifications.userId, userId),
        // Exclude read notifications older than 24h (auto-archived)
        sql`(${notifications.readAt} IS NULL OR ${notifications.readAt} > ${Date.now() - 24 * 60 * 60 * 1000})`,
      ))
      .$dynamic();

    if (options?.unreadOnly) {
      query = query.where(and(
        eq(notifications.userId, userId),
        sql`${notifications.readAt} IS NULL`
      ));
    }

    const results = await query
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return results.map(row => ({
      id: row.id,
      userId: row.userId,
      actorId: row.actorId,
      type: row.type,
      jobId: row.jobId,
      title: row.title,
      message: row.message,
      metadata: row.metadata,
      linkTo: row.linkTo,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })) as Notification[];
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        sql`${notifications.readAt} IS NULL`
      ));
    
    return Number(result.count) || 0;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db
      .insert(notifications)
      .values({ id: randomUUID(), ...notification } as any)
      .returning();
    return newNotification;
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<Notification> {
    const [notification] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      ))
      .returning();

    if (!notification) throw new Error('Notification not found or does not belong to user');
    return notification;
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.userId, userId),
        sql`${notifications.readAt} IS NULL`
      ));
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const result = await db
      .delete(notifications)
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      ))
      .returning();

    if (result.length === 0) {
      throw new Error('Notification not found or does not belong to user');
    }
  }

  async getOverdueJobs(officeId: string): Promise<any[]> {
    const rules = await this.getNotificationRulesByOffice(officeId);
    const overdueJobs = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rule.maxDays);

      const jobsForStatus = await db
        .select()
        .from(jobs)
        .where(and(
          eq(jobs.officeId, officeId),
          eq(jobs.status, rule.status),
          lte(jobs.statusChangedAt, cutoffDate)
        ));

      for (const job of jobsForStatus) {
        const daysOverdue = Math.floor(
          (Date.now() - job.statusChangedAt.getTime()) / (1000 * 60 * 60 * 24)
        ) - rule.maxDays;

        let severity = 'low';
        if (daysOverdue > 7) severity = 'critical';
        else if (daysOverdue > 3) severity = 'high';
        else if (daysOverdue > 1) severity = 'medium';

        overdueJobs.push({
          ...job,
          daysOverdue,
          severity,
          rule
        });
      }
    }

    return overdueJobs.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (severityOrder as any)[a.severity] - (severityOrder as any)[b.severity];
    });
  }

  async getPlatformStats(): Promise<{
    totalOffices: number;
    activeOffices: number;
    totalUsers: number;
    totalJobs: number;
    activeJobs: number;
    archivedJobs: number;
    avgCompletionTime: number | null;
  }> {
    const [officeStats] = await db
      .select({
        totalOffices: sql`count(*)`,
        activeOffices: sql`sum(case when ${offices.enabled} = 1 then 1 else 0 end)`
      })
      .from(offices);

    const [userStats] = await db
      .select({ totalUsers: sql`count(*)` })
      .from(users);

    const [jobStats] = await db
      .select({ activeJobs: sql`count(*)` })
      .from(jobs);

    const [archivedStats] = await db
      .select({ archivedJobs: sql`count(*)` })
      .from(archivedJobs);

    const [completionTimeStats] = await db
      .select({
        avgCompletionTime: sql`avg((${archivedJobs.archivedAt} - ${archivedJobs.originalCreatedAt}) / 86400000.0)`
      })
      .from(archivedJobs)
      .where(eq(archivedJobs.finalStatus, 'completed'));

    return {
      totalOffices: Number(officeStats.totalOffices) || 0,
      activeOffices: Number(officeStats.activeOffices) || 0,
      totalUsers: Number(userStats.totalUsers) || 0,
      totalJobs: (Number(jobStats.activeJobs) || 0) + (Number(archivedStats.archivedJobs) || 0),
      activeJobs: Number(jobStats.activeJobs) || 0,
      archivedJobs: Number(archivedStats.archivedJobs) || 0,
      avgCompletionTime: completionTimeStats.avgCompletionTime ? Number(completionTimeStats.avgCompletionTime) : null,
    };
  }

  async getAllOffices(): Promise<Office[]> {
    return db
      .select()
      .from(offices)
      .orderBy(desc(offices.createdAt));
  }

  async getOfficeWithMetrics(officeId: string): Promise<{
    office: Office;
    userCount: number;
    activeJobCount: number;
    archivedJobCount: number;
  }> {
    const [office] = await db
      .select()
      .from(offices)
      .where(eq(offices.id, officeId));

    if (!office) throw new Error('Office not found');

    const [userCount] = await db
      .select({ count: sql`count(*)` })
      .from(users)
      .where(eq(users.officeId, officeId));

    const [activeJobCount] = await db
      .select({ count: sql`count(*)` })
      .from(jobs)
      .where(eq(jobs.officeId, officeId));

    const [archivedJobCount] = await db
      .select({ count: sql`count(*)` })
      .from(archivedJobs)
      .where(eq(archivedJobs.officeId, officeId));

    return {
      office,
      userCount: Number(userCount.count) || 0,
      activeJobCount: Number(activeJobCount.count) || 0,
      archivedJobCount: Number(archivedJobCount.count) || 0,
    };
  }

  async toggleOfficeStatus(officeId: string, enabled: boolean): Promise<Office> {
    const [office] = await db
      .update(offices)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(offices.id, officeId))
      .returning();

    if (!office) throw new Error('Office not found');
    return office;
  }

  async createAuditLog(log: InsertAdminAuditLog): Promise<AdminAuditLog> {
    const [auditLog] = await db
      .insert(adminAuditLogs)
      .values({ id: randomUUID(), ...log } as any)
      .returning();
    return auditLog;
  }

  async getAdminActivity(limit: number = 50): Promise<AdminAuditLog[]> {
    return db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(limit);
  }

  async createPhiAccessLog(log: InsertPhiAccessLog): Promise<PhiAccessLog> {
    const [accessLog] = await db
      .insert(phiAccessLogs)
      .values({ id: randomUUID(), ...log } as any)
      .returning();
    return accessLog;
  }

  async getPhiAccessLogs(options?: { userId?: string; officeId?: string; entityType?: string; startDate?: Date; endDate?: Date; limit?: number }): Promise<PhiAccessLog[]> {
    const conditions = [];
    
    if (options?.userId) {
      conditions.push(eq(phiAccessLogs.userId, options.userId));
    }
    if (options?.officeId) {
      conditions.push(eq(phiAccessLogs.officeId, options.officeId));
    }
    if (options?.entityType) {
      conditions.push(eq(phiAccessLogs.entityType, options.entityType));
    }
    if (options?.startDate) {
      conditions.push(gte(phiAccessLogs.createdAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(phiAccessLogs.createdAt, options.endDate));
    }

    const query = db
      .select()
      .from(phiAccessLogs)
      .orderBy(desc(phiAccessLogs.createdAt))
      .limit(options?.limit || 1000);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  // ── Order-sheet automation ledger ──────────────────────────────────

  async getOrderSheetImportsByOffice(officeId: string, limit = 200): Promise<OrderSheetImport[]> {
    return db
      .select()
      .from(orderSheetImports)
      .where(eq(orderSheetImports.officeId, officeId))
      .orderBy(desc(orderSheetImports.createdAt))
      .limit(limit);
  }

  async getOrderSheetImport(id: string): Promise<OrderSheetImport | undefined> {
    const [record] = await db.select().from(orderSheetImports).where(eq(orderSheetImports.id, id));
    return record || undefined;
  }

  async getOrderSheetImportByHash(officeId: string, contentHash: string): Promise<OrderSheetImport | undefined> {
    const [record] = await db
      .select()
      .from(orderSheetImports)
      .where(and(eq(orderSheetImports.officeId, officeId), eq(orderSheetImports.contentHash, contentHash)));
    return record || undefined;
  }

  async getKnownOrderSheetHashes(officeId: string, hashes: string[]): Promise<string[]> {
    if (!hashes.length) return [];
    const rows = await db
      .select({ contentHash: orderSheetImports.contentHash })
      .from(orderSheetImports)
      .where(and(eq(orderSheetImports.officeId, officeId), inArray(orderSheetImports.contentHash, hashes)));
    return rows.map((row) => row.contentHash);
  }

  async createOrderSheetImport(record: InsertOrderSheetImport): Promise<OrderSheetImport> {
    const [created] = await db
      .insert(orderSheetImports)
      .values({ id: randomUUID(), ...record })
      .returning();
    return created;
  }

  async updateOrderSheetImport(id: string, updates: Partial<OrderSheetImport>): Promise<OrderSheetImport> {
    const [updated] = await db
      .update(orderSheetImports)
      .set({ ...updates, processedAt: new Date() })
      .where(eq(orderSheetImports.id, id))
      .returning();
    if (!updated) throw new Error("Order sheet import not found");
    return updated;
  }

  // Write the JPEG render of page 1 to disk and stamp the ledger row. The
  // path stored on the row is RELATIVE to the data dir so the same row
  // works on an installer that moved its data folder (e.g. via env). The
  // file is written under <data>/order-sheet-attachments/<id>.jpg with
  // owner-only perms.
  async saveOrderSheetAttachment(importId: string, jpegBuffer: Buffer, pageCount: number): Promise<OrderSheetImport> {
    const relPath = path.posix.join("order-sheet-attachments", `${importId}.jpg`);
    const absPath = path.join(getDataDir(), relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(absPath, jpegBuffer, { mode: 0o600 });
    return this.updateOrderSheetImport(importId, {
      attachmentPath: relPath,
      attachmentSize: jpegBuffer.byteLength,
      attachmentPageCount: pageCount,
    });
  }

  // Lookup by stable orderId so active and ARCHIVED jobs both resolve to
  // their attachment — order_sheet_imports.jobId points at the active job
  // UUID, which changes on archive, but jobOrderId mirrors the ORD-…
  // number that's stable for the life of the order.
  async getOrderSheetImportByJobOrderId(officeId: string, jobOrderId: string): Promise<OrderSheetImport | undefined> {
    const [record] = await db
      .select()
      .from(orderSheetImports)
      .where(and(eq(orderSheetImports.officeId, officeId), eq(orderSheetImports.jobOrderId, jobOrderId)));
    return record || undefined;
  }

  // Returns the absolute disk path to the attachment, or null if the row
  // has no attachment OR the file vanished from disk (e.g. user wiped the
  // data dir). Resolution clamps inside the data dir as a defense against
  // a malformed relative path.
  resolveOrderSheetAttachmentPath(record: OrderSheetImport): string | null {
    if (!record.attachmentPath) return null;
    const dataDir = getDataDir();
    const resolved = path.resolve(dataDir, record.attachmentPath);
    if (!resolved.startsWith(path.resolve(dataDir) + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  }

  // ── Order-sheet watcher presence ───────────────────────────────────

  async upsertOrderSheetWatcher(record: {
    deviceId: string;
    officeId: string;
    deviceLabel?: string | null;
    folderPath?: string | null;
    enabled: boolean;
    state: string;
    error?: string | null;
  }): Promise<OrderSheetWatcher> {
    const values = {
      deviceId: record.deviceId,
      officeId: record.officeId,
      deviceLabel: record.deviceLabel ?? null,
      folderPath: record.folderPath ?? null,
      enabled: record.enabled,
      state: record.state,
      error: record.error ?? null,
      lastHeartbeatAt: new Date(),
    };
    const [watcher] = await db
      .insert(orderSheetWatchers)
      .values(values)
      .onConflictDoUpdate({ target: orderSheetWatchers.deviceId, set: values })
      .returning();
    return watcher;
  }

  async getOrderSheetWatchersByOffice(
    officeId: string,
  ): Promise<Array<OrderSheetWatcher & { customName: string | null }>> {
    // Join the Computers-tab registry so a device an admin renamed
    // ("Front Desk") shows that name instead of the UA-derived label.
    const rows = await db
      .select({
        watcher: orderSheetWatchers,
        customName: clientDevices.name,
      })
      .from(orderSheetWatchers)
      .leftJoin(clientDevices, eq(clientDevices.id, orderSheetWatchers.deviceId))
      .where(eq(orderSheetWatchers.officeId, officeId))
      .orderBy(desc(orderSheetWatchers.lastHeartbeatAt));

    // Self-clean display: a watcher that was switched OFF and hasn't been
    // heard from in a week is just noise (machine reconfigured or gone).
    // Rows that were last seen ENABLED stay visible however stale they
    // are — "your front desk stopped reporting" is exactly the news this
    // panel exists to deliver.
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows
      .filter((row) => row.watcher.enabled || new Date(row.watcher.lastHeartbeatAt).getTime() >= weekAgo)
      .map((row) => ({ ...row.watcher, customName: row.customName ?? null }));
  }

  async deleteOrderSheetWatcher(officeId: string, deviceId: string): Promise<void> {
    await db
      .delete(orderSheetWatchers)
      .where(and(eq(orderSheetWatchers.officeId, officeId), eq(orderSheetWatchers.deviceId, deviceId)));
  }
}

export const storage = new DatabaseStorage();
