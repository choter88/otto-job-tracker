import type { Job, User, JobComment, NotificationRule } from "@shared/schema";
import type { DatabaseStorage } from "./storage";
import { broadcastToOffice } from "./sync-websocket";

function debugLog(message: string): void {
  if (process.env.OTTO_DEBUG === "true") {
    console.log(message);
  }
}

export async function notifyJobStatusChange(
  job: Job,
  oldStatus: string,
  changedBy: User,
  storage: DatabaseStorage
): Promise<void> {
  try {
    debugLog(`[notifyJobStatusChange] jobId=${job.id} status=${oldStatus}→${job.status}`);

    // Only notify users who have flagged this job as important (not all office users)
    const flaggedBy = await storage.getJobFlaggedBy(job.id);
    const recipientIds = flaggedBy
      .map(f => f.userId)
      .filter(id => id !== changedBy.id);

    debugLog(`[notifyJobStatusChange] flagged recipients=${recipientIds.length}`);

    if (recipientIds.length === 0) {
      return;
    }

    const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim() || "Unnamed patient";

    const notifications = await Promise.all(
      recipientIds.map(async (userId) => {
        return storage.createNotification({
          userId,
          type: "status_change",
          title: `${patientName} — status changed`,
          message: `${changedBy.firstName} changed: ${oldStatus} → ${job.status}`,
          jobId: job.id,
          linkTo: `/jobs/${job.id}`,
          actorId: changedBy.id,
          metadata: {
            oldStatus,
            newStatus: job.status,
            orderId: job.orderId
          }
        });
      })
    );

    debugLog(`[notifyJobStatusChange] created=${notifications.length}`);

    if (notifications.length > 0) {
      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "status_change" });
    }
  } catch (error) {
    console.error("Error sending job status change notifications:", error);
    // Notification delivery is best-effort and should not fail job updates.
  }
}

export async function notifyNewComment(
  job: Job,
  comment: JobComment,
  author: User,
  storage: DatabaseStorage
): Promise<void> {
  try {
    // Recipient set = "everyone with skin in the game on this job":
    //   - the job's creator
    //   - everyone who has commented on this job before (the conversation
    //     thread)
    //   - everyone who has starred it
    // …minus the author, who already knows.
    //
    // This was previously only "users who starred the job", which is why
    // a comment correctly bumped the per-job comment bubble but never
    // produced a notification for the creator or other participants.
    const [flaggedBy, allComments] = await Promise.all([
      storage.getJobFlaggedBy(job.id),
      storage.getJobComments(job.id),
    ]);
    const recipientSet = new Set<string>();
    if (job.createdBy) recipientSet.add(job.createdBy);
    for (const f of flaggedBy) recipientSet.add(f.userId);
    for (const c of allComments) recipientSet.add(c.authorId);
    recipientSet.delete(author.id);

    if (recipientSet.size === 0) return;

    const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim() || "Unnamed patient";
    const truncatedContent = comment.content.length > 100
      ? `${comment.content.substring(0, 100)}...`
      : comment.content;

    const created = await Promise.all(
      Array.from(recipientSet).map((userId) =>
        storage.createNotification({
          userId,
          type: "comment",
          title: `${patientName} — new comment`,
          message: `${author.firstName}: ${truncatedContent}`,
          jobId: job.id,
          linkTo: `/jobs/${job.id}`,
          actorId: author.id,
          metadata: {
            commentId: comment.id,
            orderId: job.orderId,
          },
        }),
      ),
    );

    // Tell every connected client to refetch — the bell's unread-count
    // query invalidates on office_updated, so badges update without
    // waiting for the 30s poll.
    if (created.length > 0) {
      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "comment" });
    }
  } catch (error) {
    console.error("Error sending new comment notifications:", error);
  }
}

export async function notifyJobStarred(
  job: Job,
  starredBy: User,
  storage: DatabaseStorage,
  importantNote?: string,
): Promise<void> {
  try {
    // Two kinds of star:
    //  - With a note, the user wrote a message FOR the team — that's the
    //    explicit "please pay attention" signal, so it reaches everyone.
    //  - A plain star is mostly personal bookkeeping ("I'm tracking
    //    this"). Broadcasting every bookmark to the whole office buried
    //    the bell, so it now only tells the job's creator someone is
    //    watching their job.
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    const hasNote = Boolean(importantNote && importantNote.trim());
    const recipients = officeUsers.filter((u) =>
      u.id !== starredBy.id && (hasNote || u.id === job.createdBy),
    );
    if (recipients.length === 0) return;

    const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim() || "Unnamed patient";
    const noteSnippet = importantNote && importantNote.trim()
      ? importantNote.trim().length > 100
        ? `${importantNote.trim().substring(0, 100)}…`
        : importantNote.trim()
      : null;
    const message = noteSnippet
      ? `${starredBy.firstName} starred this — "${noteSnippet}"`
      : `${starredBy.firstName} starred this job`;

    const created = await Promise.all(
      recipients.map((user) =>
        storage.createNotification({
          userId: user.id,
          type: "team_update",
          title: `${patientName} — starred`,
          message,
          jobId: job.id,
          linkTo: `/jobs/${job.id}`,
          actorId: starredBy.id,
          metadata: {
            orderId: job.orderId,
            importantNote: importantNote ?? null,
          },
        }),
      ),
    );

    if (created.length > 0) {
      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "job_flagged" });
    }
  } catch (error) {
    console.error("Error sending star-job notifications:", error);
  }
}

// Auto-created jobs from the order-sheet folder watcher. Fan out one
// notification per office member — including the "createdBy" user,
// since auto-imports aren't a deliberate action they took, they just
// happened in the background. The notification's unread state is what
// drives the "New" badge on the worklist row; clearing it (open the
// bell, hit "Mark all read", or click into the job) removes the badge.
export async function notifyJobAutoCreated(
  job: Job,
  fileName: string,
  storage: DatabaseStorage,
): Promise<void> {
  try {
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    if (officeUsers.length === 0) return;

    const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim()
      || job.trayNumber
      || "Unnamed patient";
    const safeFileName = fileName.length > 80 ? `${fileName.slice(0, 77)}…` : fileName;

    const created = await Promise.all(
      officeUsers.map((user) =>
        storage.createNotification({
          userId: user.id,
          type: "job_auto_created",
          title: `New job: ${patientName}`,
          message: `Created automatically from ${safeFileName}`,
          jobId: job.id,
          linkTo: `/jobs/${job.id}`,
          actorId: null,
          metadata: { orderId: job.orderId, fileName },
        }),
      ),
    );

    if (created.length > 0) {
      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "order_sheet_automation" });
    }
  } catch (error) {
    console.error("Error sending auto-created job notifications:", error);
  }
}

export async function notifyOverdueJob(
  job: Job,
  rule: NotificationRule,
  storage: DatabaseStorage
): Promise<void> {
  try {
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    
    const notifications = await Promise.all(
      officeUsers.map(user => 
        storage.createNotification({
          userId: user.id,
          type: "overdue_alert",
          title: `${`${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim() || "Unnamed patient"} — overdue`,
          message: `In ${job.status} for ${rule.maxDays} days`,
          jobId: job.id,
          linkTo: `/jobs/${job.id}`,
          actorId: null,
          metadata: {
            ruleId: rule.id,
            maxDays: rule.maxDays,
            orderId: job.orderId
          }
        })
      )
    );
    
    if (notifications.length > 0) {
      broadcastToOffice(job.officeId, { type: "office_updated", ts: Date.now(), source: "overdue_alert" });
    }
  } catch (error) {
    console.error("Error sending overdue job notifications:", error);
  }
}
