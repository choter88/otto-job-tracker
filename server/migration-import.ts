import { randomUUID } from "crypto";
import { sqlite } from "./db";

type ImportAdmin = {
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
};

export type ImportSnapshotResult = {
  officeId: string;
  adminEmail: string;
  importedCounts: Record<string, number>;
};

type SnapshotTopLevel = {
  format?: unknown;
  version?: unknown;
  exportedAt?: unknown;
  office?: unknown;
  users?: unknown;
  jobs?: unknown;
  archivedJobs?: unknown;
  jobComments?: unknown;
  commentReads?: unknown;
  jobFlags?: unknown;
  jobStatusHistory?: unknown;
  notificationRules?: unknown;
};

function requireObject(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function requireArray(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

function toBoolInt(value: unknown, fallback = 0): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return 1;
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") return 0;
  }
  return fallback;
}

function toTsMs(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toJsonString(value: unknown, fallback: any): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return JSON.stringify(fallback);
    return trimmed;
  }
  if (value === null || value === undefined) return JSON.stringify(fallback);
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(fallback);
  }
}

function assertNoDuplicates(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Snapshot contains duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

export function importSnapshotV1(params: {
  snapshot: unknown;
  admin: ImportAdmin;
  staffCodeHash: string;
  activationCodeLast4: string;
  activationVerifiedAt: number | null;
  now?: number;
}): ImportSnapshotResult {
  const now = typeof params.now === "number" && params.now > 0 ? params.now : Date.now();

  const top = requireObject(params.snapshot, "Snapshot") as SnapshotTopLevel & Record<string, any>;
  if (top.format !== "otto-snapshot") {
    throw new Error("Snapshot format is not supported (expected format: otto-snapshot)");
  }
  if (top.version !== 1) {
    throw new Error("Snapshot version is not supported (expected version: 1)");
  }

  const officeRaw = requireObject(top.office, "office");
  const officeId = asString(officeRaw.id).trim();
  const officeName = asString(officeRaw.name).trim();
  if (!officeId) throw new Error("office.id is required");
  if (!officeName) throw new Error("office.name is required");

  const usersRaw = requireArray(top.users, "users").map((u, idx) => ({ idx, raw: u }));
  const jobsRaw = requireArray(top.jobs, "jobs").map((j, idx) => ({ idx, raw: j }));
  const archivedJobsRaw = requireArray(top.archivedJobs, "archivedJobs").map((j, idx) => ({ idx, raw: j }));
  const jobCommentsRaw = requireArray(top.jobComments, "jobComments").map((c, idx) => ({ idx, raw: c }));
  const commentReadsRaw = requireArray(top.commentReads, "commentReads").map((c, idx) => ({ idx, raw: c }));
  const jobFlagsRaw = requireArray(top.jobFlags, "jobFlags").map((f, idx) => ({ idx, raw: f }));
  const jobStatusHistoryRaw = requireArray(top.jobStatusHistory, "jobStatusHistory").map((h, idx) => ({ idx, raw: h }));
  const notificationRulesRaw = requireArray(top.notificationRules, "notificationRules").map((r, idx) => ({ idx, raw: r }));

  const userRows: any[] = [];
  for (const { idx, raw } of usersRaw) {
    const u = requireObject(raw, `users[${idx}]`);
    const id = asString(u.id).trim();
    const email = normalizeEmail(u.email);
    const password = asString(u.password).trim();
    const firstName = asString(u.firstName).trim();
    const lastName = asString(u.lastName).trim();
    const role = asString(u.role).trim() || "staff";
    const createdAt = toTsMs(u.createdAt, now);
    const updatedAt = toTsMs(u.updatedAt, createdAt);

    if (!id) throw new Error(`users[${idx}].id is required`);
    if (!email) throw new Error(`users[${idx}].email is required`);
    if (!password) throw new Error(`users[${idx}].password is required`);
    if (!firstName) throw new Error(`users[${idx}].firstName is required`);
    if (!lastName) throw new Error(`users[${idx}].lastName is required`);

    userRows.push({
      id,
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      role,
      office_id: officeId,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }

  // Ensure admin user exists (either override snapshot user by email or add a new owner user).
  const adminEmail = normalizeEmail(params.admin.email);
  if (!adminEmail) {
    throw new Error("Admin email is required");
  }

  const existingAdmin = userRows.find((u) => String(u.email).toLowerCase() === adminEmail);
  if (existingAdmin) {
    existingAdmin.password = params.admin.passwordHash;
    existingAdmin.first_name = params.admin.firstName;
    existingAdmin.last_name = params.admin.lastName;
    existingAdmin.role = "owner";
    existingAdmin.updated_at = now;
  } else {
    userRows.push({
      id: randomUUID(),
      email: adminEmail,
      password: params.admin.passwordHash,
      first_name: params.admin.firstName,
      last_name: params.admin.lastName,
      role: "owner",
      office_id: officeId,
      created_at: now,
      updated_at: now,
    });
  }

  assertNoDuplicates(userRows.map((u) => u.id), "user id");
  assertNoDuplicates(userRows.map((u) => u.email), "user email");

  const userIdSet = new Set(userRows.map((u) => u.id));

  const jobRows: any[] = [];
  const jobOriginalLinks: { id: string; originalJobId: string }[] = [];
  for (const { idx, raw } of jobsRaw) {
    const j = requireObject(raw, `jobs[${idx}]`);
    const id = asString(j.id).trim();
    const orderId = asString(j.orderId || j.order_id).trim();
    const patientFirstName = asString(
      j.patientFirstName || j.patient_first_name || j.patientFirstInitial || j.patient_first_initial,
    ).trim();
    const patientLastName = asString(j.patientLastName || j.patient_last_name).trim();
    const trayNumber = asString(j.trayNumber || j.tray_number).trim() || null;
    const phone = asString(j.phone).trim() || null;
    const jobType = asString(j.jobType || j.job_type).trim();
    const status = asString(j.status).trim() || "job_created";
    const orderDestination = asString(j.orderDestination || j.order_destination).trim();
    const createdBy = asString(j.createdBy || j.created_by).trim() || null;
    const statusChangedAt = toTsMs(j.statusChangedAt || j.status_changed_at, toTsMs(j.updatedAt, now));
    const customColumnValues = toJsonString(j.customColumnValues ?? j.custom_column_values, {});
    const isRedoJob = toBoolInt(j.isRedoJob ?? j.is_redo_job, 0);
    const originalJobId = asString(j.originalJobId || j.original_job_id).trim();
    const notes = asString(j.notes).trim() || null;
    const createdAt = toTsMs(j.createdAt, now);
    const updatedAt = toTsMs(j.updatedAt, createdAt);

    if (!id) throw new Error(`jobs[${idx}].id is required`);
    if (!orderId) throw new Error(`jobs[${idx}].orderId is required`);
    if (!jobType) throw new Error(`jobs[${idx}].jobType is required`);
    if (!orderDestination) throw new Error(`jobs[${idx}].orderDestination is required`);

    if (createdBy && !userIdSet.has(createdBy)) {
      throw new Error(`jobs[${idx}].createdBy references unknown userId: ${createdBy}`);
    }

    if (originalJobId) {
      jobOriginalLinks.push({ id, originalJobId });
    }

    jobRows.push({
      id,
      order_id: orderId,
      patient_first_name: patientFirstName,
      patient_last_name: patientLastName,
      tray_number: trayNumber,
      phone,
      job_type: jobType,
      status,
      order_destination: orderDestination,
      office_id: officeId,
      created_by: createdBy,
      status_changed_at: statusChangedAt,
      custom_column_values: customColumnValues,
      is_redo_job: isRedoJob,
      original_job_id: null,
      notes,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }

  assertNoDuplicates(jobRows.map((j) => j.id), "job id");
  assertNoDuplicates(jobRows.map((j) => j.order_id), "job orderId");

  const jobIdSet = new Set(jobRows.map((j) => j.id));
  for (const link of jobOriginalLinks) {
    if (!jobIdSet.has(link.originalJobId)) {
      throw new Error(`jobs.originalJobId references unknown jobId: ${link.originalJobId}`);
    }
  }

  const archivedRows: any[] = [];
  for (const { idx, raw } of archivedJobsRaw) {
    const j = requireObject(raw, `archivedJobs[${idx}]`);
    const id = asString(j.id).trim();
    const orderId = asString(j.orderId || j.order_id).trim();
    const patientFirstName = asString(
      j.patientFirstName || j.patient_first_name || j.patientFirstInitial || j.patient_first_initial,
    ).trim();
    const patientLastName = asString(j.patientLastName || j.patient_last_name).trim();
    const trayNumber = asString(j.trayNumber || j.tray_number).trim() || null;
    const phone = asString(j.phone).trim() || null;
    const jobType = asString(j.jobType || j.job_type).trim();
    const finalStatus = asString(j.finalStatus || j.final_status).trim();
    const previousStatus = asString(j.previousStatus || j.previous_status).trim() || null;
    const orderDestination = asString(j.orderDestination || j.order_destination).trim();
    const createdBy = asString(j.createdBy || j.created_by).trim() || null;
    const originalCreatedAt = toTsMs(j.originalCreatedAt || j.original_created_at, now);
    const archivedAt = toTsMs(j.archivedAt || j.archived_at, now);
    const customColumnValues = toJsonString(j.customColumnValues ?? j.custom_column_values, {});
    const isRedoJob = toBoolInt(j.isRedoJob ?? j.is_redo_job, 0);
    const originalJobId = asString(j.originalJobId || j.original_job_id).trim() || null;
    const notes = asString(j.notes).trim() || null;

    if (!id) throw new Error(`archivedJobs[${idx}].id is required`);
    if (!orderId) throw new Error(`archivedJobs[${idx}].orderId is required`);
    if (!jobType) throw new Error(`archivedJobs[${idx}].jobType is required`);
    if (!finalStatus) throw new Error(`archivedJobs[${idx}].finalStatus is required`);
    if (!orderDestination) throw new Error(`archivedJobs[${idx}].orderDestination is required`);

    if (createdBy && !userIdSet.has(createdBy)) {
      throw new Error(`archivedJobs[${idx}].createdBy references unknown userId: ${createdBy}`);
    }

    archivedRows.push({
      id,
      order_id: orderId,
      patient_first_name: patientFirstName,
      patient_last_name: patientLastName,
      tray_number: trayNumber,
      phone,
      job_type: jobType,
      final_status: finalStatus,
      previous_status: previousStatus,
      order_destination: orderDestination,
      office_id: officeId,
      created_by: createdBy,
      original_created_at: originalCreatedAt,
      archived_at: archivedAt,
      custom_column_values: customColumnValues,
      is_redo_job: isRedoJob,
      original_job_id: originalJobId,
      notes,
    });
  }

  assertNoDuplicates(archivedRows.map((j) => j.id), "archived job id");

  const commentRows: any[] = [];
  for (const { idx, raw } of jobCommentsRaw) {
    const c = requireObject(raw, `jobComments[${idx}]`);
    const id = asString(c.id).trim();
    const jobId = asString(c.jobId || c.job_id).trim();
    const authorId = asString(c.authorId || c.author_id).trim();
    const content = asString(c.content).trim();
    const isOverdueComment = toBoolInt(c.isOverdueComment ?? c.is_overdue_comment, 0);
    const createdAt = toTsMs(c.createdAt, now);

    if (!id) throw new Error(`jobComments[${idx}].id is required`);
    if (!jobId) throw new Error(`jobComments[${idx}].jobId is required`);
    if (!authorId) throw new Error(`jobComments[${idx}].authorId is required`);
    if (!content) throw new Error(`jobComments[${idx}].content is required`);

    if (!jobIdSet.has(jobId)) throw new Error(`jobComments[${idx}] references unknown jobId: ${jobId}`);
    if (!userIdSet.has(authorId)) throw new Error(`jobComments[${idx}] references unknown userId: ${authorId}`);

    commentRows.push({
      id,
      job_id: jobId,
      author_id: authorId,
      content,
      is_overdue_comment: isOverdueComment,
      created_at: createdAt,
    });
  }
  assertNoDuplicates(commentRows.map((c) => c.id), "job comment id");

  const commentReadRows: any[] = [];
  for (const { idx, raw } of commentReadsRaw) {
    const c = requireObject(raw, `commentReads[${idx}]`);
    const id = asString(c.id).trim();
    const userId = asString(c.userId || c.user_id).trim();
    const jobId = asString(c.jobId || c.job_id).trim();
    const lastReadAt = toTsMs(c.lastReadAt || c.last_read_at, now);

    if (!id) throw new Error(`commentReads[${idx}].id is required`);
    if (!userId) throw new Error(`commentReads[${idx}].userId is required`);
    if (!jobId) throw new Error(`commentReads[${idx}].jobId is required`);

    if (!jobIdSet.has(jobId)) throw new Error(`commentReads[${idx}] references unknown jobId: ${jobId}`);
    if (!userIdSet.has(userId)) throw new Error(`commentReads[${idx}] references unknown userId: ${userId}`);

    commentReadRows.push({
      id,
      user_id: userId,
      job_id: jobId,
      last_read_at: lastReadAt,
    });
  }
  assertNoDuplicates(commentReadRows.map((c) => c.id), "comment read id");

  const flagRows: any[] = [];
  for (const { idx, raw } of jobFlagsRaw) {
    const f = requireObject(raw, `jobFlags[${idx}]`);
    const id = asString(f.id).trim();
    const userId = asString(f.userId || f.user_id).trim();
    const jobId = asString(f.jobId || f.job_id).trim();
    const summary = asString(f.summary).trim() || null;
    const summaryGeneratedAt = f.summaryGeneratedAt || f.summary_generated_at;
    const createdAt = toTsMs(f.createdAt, now);

    if (!id) throw new Error(`jobFlags[${idx}].id is required`);
    if (!userId) throw new Error(`jobFlags[${idx}].userId is required`);
    if (!jobId) throw new Error(`jobFlags[${idx}].jobId is required`);

    if (!jobIdSet.has(jobId)) throw new Error(`jobFlags[${idx}] references unknown jobId: ${jobId}`);
    if (!userIdSet.has(userId)) throw new Error(`jobFlags[${idx}] references unknown userId: ${userId}`);

    flagRows.push({
      id,
      user_id: userId,
      job_id: jobId,
      summary,
      summary_generated_at:
        summaryGeneratedAt === null || summaryGeneratedAt === undefined ? null : toTsMs(summaryGeneratedAt, now),
      created_at: createdAt,
    });
  }
  assertNoDuplicates(flagRows.map((f) => f.id), "job flag id");

  const historyRows: any[] = [];
  for (const { idx, raw } of jobStatusHistoryRaw) {
    const h = requireObject(raw, `jobStatusHistory[${idx}]`);
    const id = asString(h.id).trim();
    const jobId = asString(h.jobId || h.job_id).trim();
    const oldStatus = asString(h.oldStatus || h.old_status).trim() || null;
    const newStatus = asString(h.newStatus || h.new_status).trim();
    const changedBy = asString(h.changedBy || h.changed_by).trim();
    const changedAt = toTsMs(h.changedAt || h.changed_at, now);

    if (!id) throw new Error(`jobStatusHistory[${idx}].id is required`);
    if (!jobId) throw new Error(`jobStatusHistory[${idx}].jobId is required`);
    if (!newStatus) throw new Error(`jobStatusHistory[${idx}].newStatus is required`);
    if (!changedBy) throw new Error(`jobStatusHistory[${idx}].changedBy is required`);

    if (!jobIdSet.has(jobId)) throw new Error(`jobStatusHistory[${idx}] references unknown jobId: ${jobId}`);
    if (!userIdSet.has(changedBy)) throw new Error(`jobStatusHistory[${idx}] references unknown userId: ${changedBy}`);

    historyRows.push({
      id,
      job_id: jobId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      changed_at: changedAt,
    });
  }
  assertNoDuplicates(historyRows.map((h) => h.id), "job status history id");

  const ruleRows: any[] = [];
  for (const { idx, raw } of notificationRulesRaw) {
    const r = requireObject(raw, `notificationRules[${idx}]`);
    const id = asString(r.id).trim();
    const status = asString(r.status).trim();
    const maxDays = Number(r.maxDays ?? r.max_days);
    const enabled = toBoolInt(r.enabled, 1);
    const notifyRoles = toJsonString(r.notifyRoles ?? r.notify_roles, []);
    const notifyUsers = toJsonString(r.notifyUsers ?? r.notify_users, []);
    const createdAt = toTsMs(r.createdAt, now);

    if (!id) throw new Error(`notificationRules[${idx}].id is required`);
    if (!status) throw new Error(`notificationRules[${idx}].status is required`);
    if (!Number.isFinite(maxDays)) throw new Error(`notificationRules[${idx}].maxDays is required`);

    ruleRows.push({
      id,
      office_id: officeId,
      status,
      max_days: Math.max(0, Math.floor(maxDays)),
      enabled,
      sms_enabled: 0,
      sms_template: null,
      notify_roles: notifyRoles,
      notify_users: notifyUsers,
      created_at: createdAt,
    });
  }
  assertNoDuplicates(ruleRows.map((r) => r.id), "notification rule id");

  const mergedSettings = (() => {
    const existing = (() => {
      const raw = officeRaw.settings;
      if (!raw) return {};
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      }
      if (typeof raw === "object") return raw as any;
      return {};
    })();

    const next: Record<string, any> = { ...(existing as any) };
    next.staffSignup = { codeHash: params.staffCodeHash, rotatedAt: now };
    next.licensing = {
      activationCodeLast4: params.activationCodeLast4,
      activationAttemptedAt: now,
      activationVerifiedAt: params.activationVerifiedAt,
    };
    return next;
  })();

  const officeRow = {
    id: officeId,
    name: officeName,
    address: asString(officeRaw.address).trim() || null,
    phone: asString(officeRaw.phone).trim() || null,
    email: asString(officeRaw.email).trim() || null,
    enabled: toBoolInt(officeRaw.enabled, 1),
    settings: toJsonString(mergedSettings, {}),
    created_at: toTsMs(officeRaw.createdAt, now),
    updated_at: toTsMs(officeRaw.updatedAt, now),
  };

  const importedCounts: Record<string, number> = {
    offices: 1,
    users: userRows.length,
    jobs: jobRows.length,
    archivedJobs: archivedRows.length,
    jobComments: commentRows.length,
    commentReads: commentReadRows.length,
    jobFlags: flagRows.length,
    jobStatusHistory: historyRows.length,
    notificationRules: ruleRows.length,
  };

  const insertOffice = sqlite.prepare(
    `INSERT INTO offices (id, name, address, phone, email, enabled, settings, created_at, updated_at)
     VALUES (@id, @name, @address, @phone, @email, @enabled, @settings, @created_at, @updated_at)`,
  );

  const insertUser = sqlite.prepare(
    `INSERT INTO users (id, email, password, first_name, last_name, role, office_id, created_at, updated_at)
     VALUES (@id, @email, @password, @first_name, @last_name, @role, @office_id, @created_at, @updated_at)`,
  );

  const insertJob = sqlite.prepare(
    `INSERT INTO jobs (
        id, order_id, patient_first_name, patient_last_name, tray_number, phone,
        job_type, status, order_destination, office_id, created_by,
        status_changed_at, custom_column_values, is_redo_job, original_job_id, notes,
        created_at, updated_at
      ) VALUES (
        @id, @order_id, @patient_first_name, @patient_last_name, @tray_number, @phone,
        @job_type, @status, @order_destination, @office_id, @created_by,
        @status_changed_at, @custom_column_values, @is_redo_job, @original_job_id, @notes,
        @created_at, @updated_at
      )`,
  );

  const updateJobOriginal = sqlite.prepare(`UPDATE jobs SET original_job_id = @original_job_id WHERE id = @id`);

  const insertArchived = sqlite.prepare(
    `INSERT INTO archived_jobs (
        id, order_id, patient_first_name, patient_last_name, tray_number, phone,
        job_type, final_status, previous_status, order_destination, office_id, created_by,
        original_created_at, archived_at, custom_column_values, is_redo_job, original_job_id, notes
      ) VALUES (
        @id, @order_id, @patient_first_name, @patient_last_name, @tray_number, @phone,
        @job_type, @final_status, @previous_status, @order_destination, @office_id, @created_by,
        @original_created_at, @archived_at, @custom_column_values, @is_redo_job, @original_job_id, @notes
      )`,
  );

  const insertComment = sqlite.prepare(
    `INSERT INTO job_comments (id, job_id, author_id, content, is_overdue_comment, created_at)
     VALUES (@id, @job_id, @author_id, @content, @is_overdue_comment, @created_at)`,
  );

  const insertCommentRead = sqlite.prepare(
    `INSERT INTO comment_reads (id, user_id, job_id, last_read_at)
     VALUES (@id, @user_id, @job_id, @last_read_at)`,
  );

  const insertFlag = sqlite.prepare(
    `INSERT INTO job_flags (id, user_id, job_id, summary, summary_generated_at, created_at)
     VALUES (@id, @user_id, @job_id, @summary, @summary_generated_at, @created_at)`,
  );

  const insertHistory = sqlite.prepare(
    `INSERT INTO job_status_history (id, job_id, old_status, new_status, changed_by, changed_at)
     VALUES (@id, @job_id, @old_status, @new_status, @changed_by, @changed_at)`,
  );

  const insertRule = sqlite.prepare(
    `INSERT INTO notification_rules (
        id, office_id, status, max_days, enabled, sms_enabled, sms_template, notify_roles, notify_users, created_at
     ) VALUES (
        @id, @office_id, @status, @max_days, @enabled, @sms_enabled, @sms_template, @notify_roles, @notify_users, @created_at
     )`,
  );

  sqlite.transaction(() => {
    insertOffice.run(officeRow);
    for (const row of userRows) insertUser.run(row);
    for (const row of jobRows) insertJob.run(row);
    for (const link of jobOriginalLinks) {
      updateJobOriginal.run({ id: link.id, original_job_id: link.originalJobId });
    }
    for (const row of archivedRows) insertArchived.run(row);
    for (const row of commentRows) insertComment.run(row);
    for (const row of commentReadRows) insertCommentRead.run(row);
    for (const row of flagRows) insertFlag.run(row);
    for (const row of historyRows) insertHistory.run(row);
    for (const row of ruleRows) insertRule.run(row);
  })();

  return { officeId, adminEmail, importedCounts };
}
