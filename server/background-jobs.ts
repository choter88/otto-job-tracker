import cron from 'node-cron';
import { db } from './db';
import { 
  jobs, 
  notificationRules, 
  notifications, 
  offices, 
  users,
  smsOptIns,
  jobAnalytics,
  platformAnalytics,
  archivedJobs,
  type NotificationRule 
} from '@shared/schema';
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { sendSMS } from './twilioClient';
import { storage } from './storage';
import { randomUUID } from "crypto";
import { broadcastToOffice } from "./sync-websocket";

function substituteTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

cron.schedule('0 0 * * *', async () => {
  console.log('Running overdue detection job...');
  
  try {
    const rules = await db.select().from(notificationRules).where(eq(notificationRules.enabled, true));
    const updatedOffices = new Set<string>();
    
    for (const rule of rules) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rule.maxDays);

      const overdueJobs = await db.select()
        .from(jobs)
        .where(and(
          eq(jobs.officeId, rule.officeId),
          eq(jobs.status, rule.status),
          lte(jobs.statusChangedAt, cutoffDate),
        ));
      
      for (const job of overdueJobs) {
        const daysOverdue = Math.floor(
          (Date.now() - job.statusChangedAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        const office = await db.select().from(offices).where(eq(offices.id, job.officeId)).limit(1);
        const officePhone = office[0]?.phone || '';
        
        let recipients: string[] = [];
        
        if (rule.notifyUsers && Array.isArray(rule.notifyUsers) && rule.notifyUsers.length > 0) {
          recipients = recipients.concat(rule.notifyUsers as string[]);
        }
        
        if (rule.notifyRoles && Array.isArray(rule.notifyRoles) && rule.notifyRoles.length > 0) {
          const officeUsers = await db.select().from(users).where(eq(users.officeId, rule.officeId));
          const roleRecipients = officeUsers.filter(u => (rule.notifyRoles as string[]).includes(u.role));
          recipients = recipients.concat(roleRecipients.map(u => u.id));
        }
        
        recipients = Array.from(new Set(recipients));
        
        for (const userId of recipients) {
          await storage.createNotification({
            userId,
            type: "overdue_alert",
            title: `Job ${job.orderId} is overdue`,
            message: `Job has been in ${job.status} for ${daysOverdue} days (max ${rule.maxDays} days)`,
            jobId: job.id,
            linkTo: `/jobs/${job.id}`,
            actorId: null,
            metadata: {
              ruleId: rule.id,
              maxDays: rule.maxDays,
              daysOverdue,
              orderId: job.orderId
            }
          });
        }
        if (recipients.length > 0) {
          updatedOffices.add(rule.officeId);
        }
        
        if (rule.smsEnabled && rule.smsTemplate && job.phone) {
          const jobPhone = job.phone;
          const optIn = await db.select()
            .from(smsOptIns)
            .where(and(
              eq(smsOptIns.phone, jobPhone),
              eq(smsOptIns.officeId, job.officeId)
            ))
            .limit(1);

          if (optIn.length > 0) {
            const smsMessage = substituteTemplate(rule.smsTemplate, {
              job_type: job.jobType,
              status: job.status,
              days: daysOverdue,
              office_phone: officePhone
            });

            const result = await sendSMS(jobPhone, smsMessage);
            
            await storage.logSms({
              jobId: job.id,
              phone: jobPhone,
              message: smsMessage,
              status: result.success ? 'sent' : 'failed',
              messageSid: result.messageSid || null,
              errorCode: result.errorCode || null,
              errorMessage: result.error || null
            });
          }
        }
      }
    }

    updatedOffices.forEach((officeId) => {
      broadcastToOffice(officeId, { type: "office_updated", ts: Date.now(), source: "overdue_alert" });
    });
    
    console.log(`Overdue detection job completed. Processed ${rules.length} rules.`);
  } catch (error) {
    console.error('Overdue detection job failed:', error);
  }
});

cron.schedule('0 1 * * *', async () => {
  console.log('Running analytics aggregation job...');
  
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const allOffices = await db.select().from(offices);
    
    for (const office of allOffices) {
      const jobsCreatedToday = await db.select()
        .from(jobs)
        .where(and(
          eq(jobs.officeId, office.id),
          gte(jobs.createdAt, today),
          lt(jobs.createdAt, tomorrow)
        ));
      
      const jobsByStatus: Record<string, number> = {};
      const jobsByType: Record<string, number> = {};
      
      for (const job of jobsCreatedToday) {
        jobsByStatus[job.status] = (jobsByStatus[job.status] || 0) + 1;
        jobsByType[job.jobType] = (jobsByType[job.jobType] || 0) + 1;
      }
      
      const completedJobs = await db.select({
        avgTime: sql<number>`avg((${archivedJobs.archivedAt} - ${archivedJobs.originalCreatedAt}) / 86400000.0)`,
      })
        .from(archivedJobs)
        .where(and(
          eq(archivedJobs.officeId, office.id),
          gte(archivedJobs.originalCreatedAt, today),
          lt(archivedJobs.originalCreatedAt, tomorrow)
        ));
      
      const avgCompletionTime = completedJobs[0]?.avgTime ? Math.round(completedJobs[0].avgTime) : null;
      
      await db.insert(jobAnalytics).values({
        id: randomUUID(),
        officeId: office.id,
        date: today,
        totalJobsCreated: jobsCreatedToday.length,
        jobsByStatus,
        jobsByType,
        avgCompletionTime
      });
    }
    
    const allJobsCreatedToday = await db.select()
      .from(jobs)
      .where(and(
        gte(jobs.createdAt, today),
        lt(jobs.createdAt, tomorrow)
      ));
    
    const platformJobsByStatus: Record<string, number> = {};
    const platformJobsByType: Record<string, number> = {};
    
    for (const job of allJobsCreatedToday) {
      platformJobsByStatus[job.status] = (platformJobsByStatus[job.status] || 0) + 1;
      platformJobsByType[job.jobType] = (platformJobsByType[job.jobType] || 0) + 1;
    }
    
    const [officeStats] = await db.select({
      totalOffices: sql<number>`COUNT(*)`,
      activeOffices: sql<number>`sum(case when ${offices.enabled} = 1 then 1 else 0 end)`,
    })
      .from(offices);
    
    const [userStats] = await db.select({
      totalUsers: sql<number>`COUNT(*)`
    })
      .from(users);
    
    const platformCompletedJobs = await db.select({
      avgTime: sql<number>`avg((${archivedJobs.archivedAt} - ${archivedJobs.originalCreatedAt}) / 86400000.0)`,
    })
      .from(archivedJobs)
      .where(and(
        gte(archivedJobs.originalCreatedAt, today),
        lt(archivedJobs.originalCreatedAt, tomorrow)
      ));
    
    const platformAvgCompletionTime = platformCompletedJobs[0]?.avgTime 
      ? Math.round(platformCompletedJobs[0].avgTime) 
      : null;
    
    await db.insert(platformAnalytics).values({
      id: randomUUID(),
      date: today,
      totalOffices: Number(officeStats.totalOffices) || 0,
      activeOffices: Number(officeStats.activeOffices) || 0,
      totalUsers: Number(userStats.totalUsers) || 0,
      totalJobsCreated: allJobsCreatedToday.length,
      jobsByStatus: platformJobsByStatus,
      jobsByType: platformJobsByType,
      avgCompletionTime: platformAvgCompletionTime
    });
    
    console.log(`Analytics aggregation job completed. Processed ${allOffices.length} offices.`);
  } catch (error) {
    console.error('Analytics aggregation job failed:', error);
  }
});

export function startBackgroundJobs() {
  console.log('Background jobs scheduled - Overdue detection at midnight, Analytics at 1 AM');
}
