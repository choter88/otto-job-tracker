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
    
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    
    const recipients = officeUsers.filter(user => user.id !== changedBy.id);
    debugLog(`[notifyJobStatusChange] recipients=${recipients.length}`);
    
    if (recipients.length === 0) {
      return;
    }
    
    const notifications = await Promise.all(
      recipients.map(async (user) => {
        return storage.createNotification({
          userId: user.id,
          type: "status_change",
          title: `Job ${job.orderId} status changed`,
          message: `${changedBy.firstName} changed status from ${oldStatus} to ${job.status}`,
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
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    
    const recipients = officeUsers.filter(user => user.id !== author.id);
    
    const truncatedContent = comment.content.length > 100 
      ? `${comment.content.substring(0, 100)}...` 
      : comment.content;
    
    const notifications = await Promise.all(
      recipients.map(user => 
        storage.createNotification({
          userId: user.id,
          type: "comment",
          title: `New comment on job ${job.orderId}`,
          message: `${author.firstName} commented: ${truncatedContent}`,
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
          title: `Job ${job.orderId} is overdue`,
          message: `Job has been in ${job.status} for ${rule.maxDays} days`,
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
