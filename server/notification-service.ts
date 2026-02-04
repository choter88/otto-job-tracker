import type { Job, User, JobComment, NotificationRule } from "@shared/schema";
import type { IStorage } from "./storage";
import { broadcastToUser } from "./websocket";

export async function notifyJobStatusChange(
  job: Job,
  oldStatus: string,
  changedBy: User,
  storage: IStorage
): Promise<void> {
  try {
    console.log(`[notifyJobStatusChange] Starting notification for job ${job.id} (${job.orderId})`);
    console.log(`[notifyJobStatusChange] Status change: ${oldStatus} → ${job.status}`);
    console.log(`[notifyJobStatusChange] Changed by: ${changedBy.email}`);
    
    const officeUsers = await storage.getUsersInOffice(job.officeId);
    console.log(`[notifyJobStatusChange] Found ${officeUsers.length} users in office`);
    
    const recipients = officeUsers.filter(user => user.id !== changedBy.id);
    console.log(`[notifyJobStatusChange] Sending to ${recipients.length} recipients (excluding ${changedBy.email})`);
    
    if (recipients.length === 0) {
      console.log(`[notifyJobStatusChange] No recipients to notify, skipping`);
      return;
    }
    
    const notifications = await Promise.all(
      recipients.map(async (user) => {
        console.log(`[notifyJobStatusChange] Creating notification for user ${user.email}`);
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
    
    console.log(`[notifyJobStatusChange] Created ${notifications.length} notifications successfully`);
    
    notifications.forEach(notification => {
      try {
        broadcastToUser(notification.userId, {
          type: 'notification',
          data: notification
        });
      } catch (error) {
        console.error(`Failed to broadcast notification to user ${notification.userId}:`, error);
      }
    });
    
    console.log(`[notifyJobStatusChange] Notification process completed`);
  } catch (error) {
    console.error("Error sending job status change notifications:", error);
    // Re-throw the error so the route handler knows notification failed
    throw error;
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
    
    notifications.forEach(notification => {
      try {
        broadcastToUser(notification.userId, {
          type: 'notification',
          data: notification
        });
      } catch (error) {
        console.error(`Failed to broadcast notification to user ${notification.userId}:`, error);
      }
    });
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
    
    notifications.forEach(notification => {
      try {
        broadcastToUser(notification.userId, {
          type: 'notification',
          data: notification
        });
      } catch (error) {
        console.error(`Failed to broadcast notification to user ${notification.userId}:`, error);
      }
    });
  } catch (error) {
    console.error("Error sending overdue job notifications:", error);
  }
}
