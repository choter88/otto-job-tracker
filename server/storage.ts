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
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
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
      firstName: string;
      lastName: string;
      requestedRole: User["role"];
      requestMessage: string | null;
      requestedByIp: string | null;
      userAgent: string | null;
      createdAt: Date;
    }>
  >;
  getPendingAccountSignupRequestByEmail(officeId: string, email: string): Promise<AccountSignupRequest | undefined>;
  createAccountSignupRequest(request: InsertAccountSignupRequest): Promise<AccountSignupRequest>;
  approveAccountSignupRequest(requestId: string, officeId: string, reviewerId: string, role: User["role"]): Promise<User>;
  rejectAccountSignupRequest(requestId: string, officeId: string, reviewerId: string): Promise<void>;

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
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({ id: randomUUID(), ...insertUser })
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getOffice(id: string): Promise<Office | undefined> {
    const [office] = await db.select().from(offices).where(eq(offices.id, id));
    return office || undefined;
  }

  async createOffice(insertOffice: InsertOffice): Promise<Office> {
    const defaultSettings = {
      customStatuses: [
        { id: "job_created", label: "Job Created", color: "#2563EB", order: 1 },
        { id: "ordered", label: "Ordered", color: "#D97706", order: 2 },
        { id: "in_progress", label: "In Progress", color: "#0284C7", order: 3 },
        { id: "quality_check", label: "Quality Check", color: "#7C3AED", order: 4 },
        { id: "ready_for_pickup", label: "Ready for Pickup", color: "#16A34A", order: 5 },
        { id: "completed", label: "Completed", color: "#059669", order: 6 },
        { id: "cancelled", label: "Cancelled", color: "#DC2626", order: 7 }
      ],
      customJobTypes: [
        { id: "contacts", label: "Contacts", color: "#475569", order: 1 },
        { id: "glasses", label: "Glasses", color: "#2563EB", order: 2 },
        { id: "sunglasses", label: "Sunglasses", color: "#D97706", order: 3 },
        { id: "prescription", label: "Prescription", color: "#7C3AED", order: 4 }
      ],
      customOrderDestinations: [
        { id: "vision_lab", label: "Vision Lab", color: "#0284C7", order: 1 },
        { id: "eyetech_labs", label: "EyeTech Labs", color: "#16A34A", order: 2 },
        { id: "premium_optics", label: "Premium Optics", color: "#D97706", order: 3 }
      ],
      customColumns: [],
      smsEnabled: false,
      smsTemplates: {
        job_created: "Hi {patient_first_name}, we received your {job_type} order #{order_id}.",
        ordered: "Your {job_type} order #{order_id} has been placed and is being processed.",
        in_progress: "Update: Your {job_type} order #{order_id} is now in progress.",
        quality_check: "Update: Your {job_type} order #{order_id} is in quality check.",
        ready_for_pickup: "Great news! Your {job_type} order #{order_id} is ready for pickup.",
        completed: "Your {job_type} order #{order_id} has been completed.",
        cancelled:
          "Update: Your {job_type} order #{order_id} was cancelled. Please contact {office_name} at {office_phone}."
      }
    };

    const [office] = await db
      .insert(offices)
      .values({ id: randomUUID(), ...insertOffice, settings: defaultSettings })
      .returning();
    return office;
  }

  async updateOffice(id: string, updates: Partial<Office>): Promise<Office> {
    const [office] = await db
      .update(offices)
      .set({ ...updates, updatedAt: new Date() })
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
    
    // Add name filtering
    if (name && name.trim()) {
      conditions.push(
        sql`LOWER(${archivedJobs.patientFirstName} || ' ' || ${archivedJobs.patientLastName}) LIKE LOWER(${'%' + name.trim() + '%'})`
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
    
    return flaggedJobs;
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

  async getPendingAccountSignupRequestByEmail(
    officeId: string,
    email: string,
  ): Promise<AccountSignupRequest | undefined> {
    const [request] = await db
      .select()
      .from(accountSignupRequests)
      .where(
        and(
          eq(accountSignupRequests.officeId, officeId),
          eq(accountSignupRequests.email, email),
          eq(accountSignupRequests.status, "pending"),
        ),
      )
      .limit(1);
    return request || undefined;
  }

  async createAccountSignupRequest(request: InsertAccountSignupRequest): Promise<AccountSignupRequest> {
    const [created] = await db
      .insert(accountSignupRequests)
      .values({ id: randomUUID(), ...request })
      .returning();
    return created;
  }

  async approveAccountSignupRequest(
    requestId: string,
    officeId: string,
    reviewerId: string,
    role: User["role"],
  ): Promise<User> {
    return db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(accountSignupRequests)
        .where(
          and(
            eq(accountSignupRequests.id, requestId),
            eq(accountSignupRequests.officeId, officeId),
            eq(accountSignupRequests.status, "pending"),
          ),
        )
        .limit(1);

      if (!request) throw new Error("Account request not found");

      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, request.email))
        .limit(1);
      if (existingUser) {
        throw new Error("An account with this email already exists.");
      }

      const [user] = await tx
        .insert(users)
        .values({
          id: randomUUID(),
          email: request.email,
          password: request.passwordHash,
          firstName: request.firstName,
          lastName: request.lastName,
          role,
          officeId: request.officeId,
        })
        .returning();

      await tx
        .update(accountSignupRequests)
        .set({
          status: "approved",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          requestedRole: role,
          // Prevent long-term duplicate credential material in request history.
          passwordHash: "",
        })
        .where(eq(accountSignupRequests.id, requestId));

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
      .values({ id: randomUUID(), ...rule })
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
      .where(eq(notifications.userId, userId))
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
      .values({ id: randomUUID(), ...notification })
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
      .values({ id: randomUUID(), ...log })
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
      .values({ id: randomUUID(), ...log })
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
}

export const storage = new DatabaseStorage();
