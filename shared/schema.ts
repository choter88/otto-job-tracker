import { sql, relations } from "drizzle-orm";
import { pgTable, varchar, text, timestamp, boolean, jsonb, integer, uuid, pgEnum, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["owner", "manager", "staff", "view_only", "super_admin"]);
export const jobStatusEnum = pgEnum("job_status", ["job_created", "ordered", "in_progress", "quality_check", "ready_for_pickup", "completed", "cancelled"]);
export const jobTypeEnum = pgEnum("job_type", ["contacts", "glasses", "sunglasses", "prescription"]);
export const notificationTypeEnum = pgEnum("notification_type", ["status_change", "comment", "overdue_alert", "team_update"]);

// Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  role: userRoleEnum("role").default("staff").notNull(),
  officeId: uuid("office_id").references(() => offices.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Offices table
export const offices = pgTable("offices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  enabled: boolean("enabled").default(true).notNull(),
  settings: jsonb("settings").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Jobs table
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id", { length: 50 }).notNull().unique(),
  patientFirstInitial: varchar("patient_first_initial", { length: 1 }).notNull(),
  patientLastName: varchar("patient_last_name", { length: 100 }).notNull(),
  trayNumber: varchar("tray_number", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).default("job_created").notNull(),
  orderDestination: varchar("order_destination", { length: 255 }).notNull(),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  statusChangedAt: timestamp("status_changed_at").defaultNow().notNull(),
  customColumnValues: jsonb("custom_column_values").default({}).notNull(),
  isRedoJob: boolean("is_redo_job").default(false).notNull(),
  originalJobId: uuid("original_job_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  originalJobFk: foreignKey({
    columns: [table.originalJobId],
    foreignColumns: [table.id]
  }).onDelete('set null')
}));

// Archived jobs table
export const archivedJobs = pgTable("archived_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id", { length: 50 }).notNull(),
  patientFirstInitial: varchar("patient_first_initial", { length: 1 }).notNull(),
  patientLastName: varchar("patient_last_name", { length: 100 }).notNull(),
  trayNumber: varchar("tray_number", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  finalStatus: varchar("final_status", { length: 50 }).notNull(),
  previousStatus: varchar("previous_status", { length: 50 }),
  orderDestination: varchar("order_destination", { length: 255 }).notNull(),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  originalCreatedAt: timestamp("original_created_at").notNull(),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
  customColumnValues: jsonb("custom_column_values").default({}).notNull(),
  isRedoJob: boolean("is_redo_job").default(false).notNull(),
  originalJobId: uuid("original_job_id"),
  notes: text("notes"),
});

// Join requests table
export const joinRequests = pgTable("join_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  requesterId: uuid("requester_id").references(() => users.id).notNull(),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  message: text("message"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Invitations table
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull(),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  invitedBy: uuid("invited_by").references(() => users.id).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  message: text("message"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Job comments table
export const jobComments = pgTable("job_comments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  authorId: uuid("author_id").references(() => users.id).notNull(),
  content: text("content").notNull(),
  isOverdueComment: boolean("is_overdue_comment").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Comment reads table
export const commentReads = pgTable("comment_reads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id).notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
});

// Job flags table (for marking jobs as important)
export const jobFlags = pgTable("job_flags", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id).notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  summary: text("summary"),
  summaryGeneratedAt: timestamp("summary_generated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Job status history table
export const jobStatusHistory = pgTable("job_status_history", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  oldStatus: varchar("old_status", { length: 50 }),
  newStatus: varchar("new_status", { length: 50 }).notNull(),
  changedBy: uuid("changed_by").references(() => users.id).notNull(),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

// Notification rules table
export const notificationRules = pgTable("notification_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  maxDays: integer("max_days").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  smsEnabled: boolean("sms_enabled").default(false).notNull(),
  smsTemplate: text("sms_template"),
  notifyRoles: jsonb("notify_roles").default([]).notNull(),
  notifyUsers: jsonb("notify_users").default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Notifications table
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id).notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  linkTo: text("link_to"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdReadAtIdx: sql`CREATE INDEX IF NOT EXISTS notifications_user_id_read_at_idx ON notifications (user_id, read_at)`,
}));

// SMS opt-ins table
export const smsOptIns = pgTable("sms_opt_ins", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: varchar("phone", { length: 20 }).notNull(),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  sourceUrl: text("source_url"),
  consentedAt: timestamp("consented_at").defaultNow().notNull(),
});

// SMS logs table
export const smsLogs = pgTable("sms_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: 'set null' }),
  phone: varchar("phone", { length: 20 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  messageSid: varchar("message_sid", { length: 100 }),
  errorCode: varchar("error_code", { length: 20 }),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

// Admin audit logs table
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid("admin_id").references(() => users.id).notNull(),
  action: text("action").notNull(),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: uuid("target_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Job analytics table
export const jobAnalytics = pgTable("job_analytics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  officeId: uuid("office_id").references(() => offices.id).notNull(),
  date: timestamp("date").notNull(),
  totalJobsCreated: integer("total_jobs_created").default(0).notNull(),
  jobsByStatus: jsonb("jobs_by_status").default({}).notNull(),
  jobsByType: jsonb("jobs_by_type").default({}).notNull(),
  avgCompletionTime: integer("avg_completion_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Platform analytics table
export const platformAnalytics = pgTable("platform_analytics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  totalOffices: integer("total_offices").default(0).notNull(),
  activeOffices: integer("active_offices").default(0).notNull(),
  totalUsers: integer("total_users").default(0).notNull(),
  totalJobsCreated: integer("total_jobs_created").default(0).notNull(),
  jobsByStatus: jsonb("jobs_by_status").default({}).notNull(),
  jobsByType: jsonb("jobs_by_type").default({}).notNull(),
  avgCompletionTime: integer("avg_completion_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// PHI access logs table for HIPAA compliance
export const phiAccessLogs = pgTable("phi_access_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id).notNull(),
  officeId: uuid("office_id").references(() => offices.id),
  action: varchar("action", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  orderId: varchar("order_id", { length: 50 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const userRelations = relations(users, ({ one, many }) => ({
  office: one(offices, {
    fields: [users.officeId],
    references: [offices.id],
  }),
  createdJobs: many(jobs),
  jobComments: many(jobComments),
}));

export const officeRelations = relations(offices, ({ many }) => ({
  users: many(users),
  jobs: many(jobs),
  archivedJobs: many(archivedJobs),
  joinRequests: many(joinRequests),
  notificationRules: many(notificationRules),
}));

export const jobRelations = relations(jobs, ({ one, many }) => ({
  office: one(offices, {
    fields: [jobs.officeId],
    references: [offices.id],
  }),
  createdBy: one(users, {
    fields: [jobs.createdBy],
    references: [users.id],
  }),
  originalJob: one(jobs, {
    fields: [jobs.originalJobId],
    references: [jobs.id],
  }),
  comments: many(jobComments),
  statusHistory: many(jobStatusHistory),
}));

export const jobCommentRelations = relations(jobComments, ({ one }) => ({
  job: one(jobs, {
    fields: [jobComments.jobId],
    references: [jobs.id],
  }),
  author: one(users, {
    fields: [jobComments.authorId],
    references: [users.id],
  }),
}));

// Schema exports
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOfficeSchema = createInsertSchema(offices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  orderId: true,
}).extend({
  jobType: z.string().min(1, "Job type is required"),
  status: z.string().min(1, "Status is required"),
  statusChangedAt: z.date().or(z.string().transform(str => new Date(str))).optional(),
});

export const insertJobCommentSchema = createInsertSchema(jobComments).omit({
  id: true,
  createdAt: true,
});

export const insertCommentReadSchema = createInsertSchema(commentReads).omit({
  id: true,
  lastReadAt: true,
});

export const insertJobFlagSchema = createInsertSchema(jobFlags).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationRuleSchema = createInsertSchema(notificationRules).omit({
  id: true,
  createdAt: true,
});

export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  createdAt: true,
  expiresAt: true,
  token: true,
});

export const insertSmsOptInSchema = createInsertSchema(smsOptIns).omit({
  id: true,
  consentedAt: true,
});

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export const insertJobAnalyticsSchema = createInsertSchema(jobAnalytics).omit({
  id: true,
  createdAt: true,
});

export const insertPlatformAnalyticsSchema = createInsertSchema(platformAnalytics).omit({
  id: true,
  createdAt: true,
});

export const insertPhiAccessLogSchema = createInsertSchema(phiAccessLogs).omit({
  id: true,
  createdAt: true,
});

// Type exports
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Office = typeof offices.$inferSelect;
export type InsertOffice = z.infer<typeof insertOfficeSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type ArchivedJob = typeof archivedJobs.$inferSelect;
export type JobComment = typeof jobComments.$inferSelect;
export type InsertJobComment = z.infer<typeof insertJobCommentSchema>;
export type CommentRead = typeof commentReads.$inferSelect;
export type InsertCommentRead = z.infer<typeof insertCommentReadSchema>;
export type JobFlag = typeof jobFlags.$inferSelect;
export type InsertJobFlag = z.infer<typeof insertJobFlagSchema>;
export type NotificationRule = typeof notificationRules.$inferSelect;
export type InsertNotificationRule = z.infer<typeof insertNotificationRuleSchema>;
export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type SmsOptIn = typeof smsOptIns.$inferSelect;
export type InsertSmsOptIn = z.infer<typeof insertSmsOptInSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type JobAnalytics = typeof jobAnalytics.$inferSelect;
export type InsertJobAnalytics = z.infer<typeof insertJobAnalyticsSchema>;
export type PlatformAnalytics = typeof platformAnalytics.$inferSelect;
export type InsertPlatformAnalytics = z.infer<typeof insertPlatformAnalyticsSchema>;
export type JoinRequest = typeof joinRequests.$inferSelect;
export type PhiAccessLog = typeof phiAccessLogs.$inferSelect;
export type InsertPhiAccessLog = z.infer<typeof insertPhiAccessLogSchema>;

// Custom type for join request with requester details (returned by API)
export type JoinRequestWithRequester = {
  id: string;
  message: string | null;
  status: string;
  createdAt: Date;
  requester: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
};

// Custom type for job comment with author details (returned by API)
export type JobCommentWithAuthor = JobComment & {
  author: {
    id: string;
    firstName: string;
    lastName: string;
  };
};
