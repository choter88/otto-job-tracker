import type { Job, User, JobComment, NotificationRule } from "@shared/schema";
import type { IStorage } from "./storage";
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
  storage: IStorage
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

  } catch (error) {
    console.error("Error sending job status change notifications:", error);
    // Notification delivery is best-effort and should not fail job updates.
  }
}

export async function notifyNewComment(
  job: Job,
  comment: JobComment,
  author: User,
  storage: IStorage
): Promise<void> {
  try {
    // Only notify users who have flagged this job as important
    const flaggedBy = await storage.getJobFlaggedBy(job.id);
    const recipientIds = flaggedBy
      .map(f => f.userId)
      .filter(id => id !== author.id);

    if (recipientIds.length === 0) return;

    const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim() || "Unnamed patient";
    const truncatedContent = comment.content.length > 100
      ? `${comment.content.substring(0, 100)}...`
      : comment.content;

    await Promise.all(
      recipientIds.map(userId =>
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
            orderId: job.orderId
          }
        })
      )
    );

  } catch (error) {
    console.error("Error sending new comment notifications:", error);
  }
}

export async function notifyOverdueJob(
  job: Job,
  rule: NotificationRule,
  storage: IStorage
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
