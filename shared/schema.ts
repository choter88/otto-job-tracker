import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const userRoleValues = ["owner", "manager", "staff", "view_only", "super_admin"] as const;
const notificationTypeValues = ["status_change", "comment", "overdue_alert", "team_update", "pin_reset"] as const;

function tsMsNowSql() {
  return sql`(unixepoch() * 1000)`;
}

// Users table
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    loginId: text("login_id"),
    password: text("password").notNull(),
    pinHash: text("pin_hash"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: text("role", { enum: userRoleValues }).default("staff").notNull(),
    officeId: text("office_id").references(() => offices.id),
    preferences: text("preferences", { mode: "json" }).default("{}").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_unique").on(table.email),
    loginIdIdx: uniqueIndex("users_login_id_unique").on(table.loginId),
  }),
);

// Offices table
export const offices = sqliteTable("offices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  settings: text("settings", { mode: "json" }).$type<Record<string, any>>().default({}).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Jobs table
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    patientFirstName: text("patient_first_name").notNull(),
    patientLastName: text("patient_last_name").notNull(),
    trayNumber: text("tray_number"),
    phone: text("phone"),
    jobType: text("job_type").notNull(),
    status: text("status").default("job_created").notNull(),
    orderDestination: text("order_destination").notNull(),
    officeId: text("office_id").references(() => offices.id).notNull(),
    createdBy: text("created_by").references(() => users.id),
    statusChangedAt: integer("status_changed_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
    customColumnValues: text("custom_column_values", { mode: "json" })
      .$type<Record<string, any>>()
      .default({})
      .notNull(),
    isRedoJob: integer("is_redo_job", { mode: "boolean" }).default(false).notNull(),
    originalJobId: text("original_job_id"), // self-reference FK handled at query level
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    orderIdIdx: uniqueIndex("jobs_order_id_unique").on(table.orderId),
  }),
);

// Archived jobs table
export const archivedJobs = sqliteTable("archived_jobs", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  patientFirstName: text("patient_first_name").notNull(),
  patientLastName: text("patient_last_name").notNull(),
  trayNumber: text("tray_number"),
  phone: text("phone"),
  jobType: text("job_type").notNull(),
  finalStatus: text("final_status").notNull(),
  previousStatus: text("previous_status"),
  orderDestination: text("order_destination").notNull(),
  officeId: text("office_id").references(() => offices.id).notNull(),
  createdBy: text("created_by").references(() => users.id),
  originalCreatedAt: integer("original_created_at", { mode: "timestamp_ms" }).notNull(),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  customColumnValues: text("custom_column_values", { mode: "json" })
    .$type<Record<string, any>>()
    .default({})
    .notNull(),
  isRedoJob: integer("is_redo_job", { mode: "boolean" }).default(false).notNull(),
  originalJobId: text("original_job_id"),
  notes: text("notes"),
});

// Join requests table
export const joinRequests = sqliteTable("join_requests", {
  id: text("id").primaryKey(),
  requesterId: text("requester_id").references(() => users.id).notNull(),
  officeId: text("office_id").references(() => offices.id).notNull(),
  message: text("message"),
  status: text("status").default("pending").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Account signup requests table (account is created only after Host approval)
export const accountSignupRequests = sqliteTable(
  "account_signup_requests",
  {
    id: text("id").primaryKey(),
    officeId: text("office_id").references(() => offices.id).notNull(),
    email: text("email").notNull(),
    loginId: text("login_id"),
    passwordHash: text("password_hash").notNull(),
    pinHash: text("pin_hash"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    requestedRole: text("requested_role", { enum: userRoleValues }).default("staff").notNull(),
    status: text("status").default("pending").notNull(),
    requestMessage: text("request_message"),
    requestedByIp: text("requested_by_ip"),
    userAgent: text("user_agent"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    officeStatusCreatedIdx: index("account_signup_requests_office_status_created_idx").on(
      table.officeId,
      table.status,
      table.createdAt,
    ),
    officeEmailStatusIdx: index("account_signup_requests_office_email_status_idx").on(
      table.officeId,
      table.email,
      table.status,
    ),
    officeLoginIdStatusIdx: index("account_signup_requests_office_login_id_status_idx").on(
      table.officeId,
      table.loginId,
      table.status,
    ),
  }),
);

// PIN reset requests table (user is locked out, request goes to owner/manager)
export const pinResetRequests = sqliteTable(
  "pin_reset_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id).notNull(),
    officeId: text("office_id").references(() => offices.id).notNull(),
    newPinHash: text("new_pin_hash").notNull(),
    status: text("status").default("pending").notNull(),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    officeStatusIdx: index("pin_reset_requests_office_status_idx").on(table.officeId, table.status),
    userStatusIdx: index("pin_reset_requests_user_status_idx").on(table.userId, table.status),
  }),
);

// Invitations table
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: userRoleValues }).notNull(),
    officeId: text("office_id").references(() => offices.id).notNull(),
    invitedBy: text("invited_by").references(() => users.id).notNull(),
    token: text("token").notNull(),
    message: text("message"),
    status: text("status").default("pending").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("invitations_token_unique").on(table.token),
  }),
);

// Job comments table
export const jobComments = sqliteTable("job_comments", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  authorId: text("author_id").references(() => users.id).notNull(),
  content: text("content").notNull(),
  isOverdueComment: integer("is_overdue_comment", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Comment reads table
export const commentReads = sqliteTable(
  "comment_reads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id).notNull(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    userJobIdx: uniqueIndex("comment_reads_user_job_unique").on(table.userId, table.jobId),
  }),
);

// Job flags table (for marking jobs as important)
export const jobFlags = sqliteTable(
  "job_flags",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id).notNull(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    // Legacy AI summary fields (kept for backward compatibility).
    summary: text("summary"),
    summaryGeneratedAt: integer("summary_generated_at", { mode: "timestamp_ms" }),
    // User-authored note shown in the Important view.
    importantNote: text("important_note"),
    importantNoteUpdatedAt: integer("important_note_updated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    userJobIdx: uniqueIndex("job_flags_user_job_unique").on(table.userId, table.jobId),
  }),
);

// Job status history table
export const jobStatusHistory = sqliteTable("job_status_history", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedBy: text("changed_by").references(() => users.id).notNull(),
  changedAt: integer("changed_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Manual job link groups — user-created links between jobs (families, couples, multi-order patients)
export const jobLinkGroups = sqliteTable(
  "job_link_groups",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    groupId: text("group_id").notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    groupIdx: index("job_link_groups_group_idx").on(table.groupId),
    jobIdx: uniqueIndex("job_link_groups_job_unique").on(table.jobId),
  }),
);

// Group notes for linked jobs — shared across all jobs in a link group
export const linkGroupNotes = sqliteTable(
  "link_group_notes",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    groupIdx: index("link_group_notes_group_idx").on(table.groupId),
  }),
);

// Notification rules table
export const notificationRules = sqliteTable("notification_rules", {
  id: text("id").primaryKey(),
  officeId: text("office_id").references(() => offices.id).notNull(),
  status: text("status").notNull(),
  maxDays: integer("max_days").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  smsEnabled: integer("sms_enabled", { mode: "boolean" }).default(false).notNull(),
  smsTemplate: text("sms_template"),
  notifyRoles: text("notify_roles", { mode: "json" }).$type<string[]>().default([]).notNull(),
  notifyUsers: text("notify_users", { mode: "json" }).$type<string[]>().default([]).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Notifications table
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id).notNull(),
    actorId: text("actor_id").references(() => users.id),
    type: text("type", { enum: notificationTypeValues }).notNull(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, any> | null>(),
    linkTo: text("link_to"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    userIdReadAtIdx: index("notifications_user_id_read_at_idx").on(table.userId, table.readAt),
  }),
);

// SMS opt-ins table
export const smsOptIns = sqliteTable("sms_opt_ins", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  officeId: text("office_id").references(() => offices.id).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  sourceUrl: text("source_url"),
  consentedAt: integer("consented_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// SMS logs table
export const smsLogs = sqliteTable("sms_logs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  messageSid: text("message_sid"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Admin audit logs table
export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  adminId: text("admin_id").references(() => users.id).notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, any> | null>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Job analytics table
export const jobAnalytics = sqliteTable("job_analytics", {
  id: text("id").primaryKey(),
  officeId: text("office_id").references(() => offices.id).notNull(),
  date: integer("date", { mode: "timestamp_ms" }).notNull(),
  totalJobsCreated: integer("total_jobs_created").default(0).notNull(),
  jobsByStatus: text("jobs_by_status", { mode: "json" }).$type<Record<string, any>>().default({}).notNull(),
  jobsByType: text("jobs_by_type", { mode: "json" }).$type<Record<string, any>>().default({}).notNull(),
  avgCompletionTime: integer("avg_completion_time"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Platform analytics table
export const platformAnalytics = sqliteTable("platform_analytics", {
  id: text("id").primaryKey(),
  date: integer("date", { mode: "timestamp_ms" }).notNull(),
  totalOffices: integer("total_offices").default(0).notNull(),
  activeOffices: integer("active_offices").default(0).notNull(),
  totalUsers: integer("total_users").default(0).notNull(),
  totalJobsCreated: integer("total_jobs_created").default(0).notNull(),
  jobsByStatus: text("jobs_by_status", { mode: "json" }).$type<Record<string, any>>().default({}).notNull(),
  jobsByType: text("jobs_by_type", { mode: "json" }).$type<Record<string, any>>().default({}).notNull(),
  avgCompletionTime: integer("avg_completion_time"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// PHI access logs table for HIPAA compliance
export const phiAccessLogs = sqliteTable("phi_access_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id).notNull(),
  officeId: text("office_id").references(() => offices.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  orderId: text("order_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: text("details", { mode: "json" }).$type<Record<string, any> | null>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
});

// Usage events table — anonymous action tracking for product analytics
export const usageEvents = sqliteTable("usage_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  officeId: text("office_id"),
  eventType: text("event_type").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
}, (table) => ({
  createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
  eventTypeCreatedAtIdx: index("usage_events_event_type_created_at_idx").on(table.eventType, table.createdAt),
}));

export type UsageEvent = typeof usageEvents.$inferSelect;

// Client device registry — tracks which computers connect as clients
export const clientDevices = sqliteTable("client_devices", {
  id: text("id").primaryKey(), // deviceId generated by client
  officeId: text("office_id"),
  label: text("label"), // user agent or friendly name
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  blocked: integer("blocked", { mode: "boolean" }).default(false).notNull(),
});

export type ClientDevice = typeof clientDevices.$inferSelect;

// Tablet sessions — per-user auth tokens for the tablet lab board
export const tabletSessions = sqliteTable(
  "tablet_sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    userId: text("user_id").references(() => users.id).notNull(),
    officeId: text("office_id").references(() => offices.id).notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).default(tsMsNowSql()).notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("tablet_sessions_token_unique").on(table.token),
    userIdx: index("tablet_sessions_user_idx").on(table.userId),
  }),
);

export type TabletSession = typeof tabletSessions.$inferSelect;

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

export const insertJobSchema = createInsertSchema(jobs)
  .omit({
    createdAt: true,
    updatedAt: true,
    orderId: true,
  })
  .extend({
    id: z.string().min(1).optional(),
    jobType: z.string().min(1, "Job type is required"),
    status: z.string().min(1, "Status is required"),
    statusChangedAt: z.date().or(z.string().transform((str) => new Date(str))).optional(),
  });

export const insertJobCommentSchema = createInsertSchema(jobComments)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    id: z.string().min(1).optional(),
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

export const insertAccountSignupRequestSchema = createInsertSchema(accountSignupRequests).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
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
export type PublicUser = Omit<User, "password" | "pinHash">;
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
export type AccountSignupRequest = typeof accountSignupRequests.$inferSelect;
export type InsertAccountSignupRequest = z.infer<typeof insertAccountSignupRequestSchema>;
export type PhiAccessLog = typeof phiAccessLogs.$inferSelect;
export type InsertPhiAccessLog = z.infer<typeof insertPhiAccessLogSchema>;
export type PinResetRequest = typeof pinResetRequests.$inferSelect;

// Custom type for PIN reset request with user details (returned by API)
export type PinResetRequestWithUser = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  loginId: string | null;
  status: string;
  createdAt: Date;
};

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
