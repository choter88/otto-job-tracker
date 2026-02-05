import OpenAI from "openai";
import type { Job, JobCommentWithAuthor } from "@shared/schema";
import { storage } from "./storage";
import { db } from "./db";
import { jobStatusHistory, users, jobFlags, jobComments } from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";

function aiSummaryEnabled(): boolean {
  if (process.env.OTTO_AIRGAP === "true") return false;
  if (process.env.OTTO_ENABLE_AI_SUMMARY !== "true") return false;
  if (process.env.OTTO_ALLOW_PHI_EGRESS !== "true") return false;
  return Boolean(process.env.OPENAI_API_KEY);
}

const openai = aiSummaryEnabled()
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

interface StatusHistoryEntry {
  oldStatus: string | null;
  newStatus: string;
  changedAt: Date;
  changedBy: {
    firstName: string;
    lastName: string;
  };
}

export async function generateJobSummary(jobId: string, officeSettings: any): Promise<string> {
  try {
    // Fetch job details
    const job = await storage.getJob(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    if (!openai) {
      const statusLabel =
        officeSettings?.customStatuses?.find((s: any) => s.id === job.status)?.label || job.status;
      const jobTypeLabel =
        officeSettings?.customJobTypes?.find((t: any) => t.id === job.jobType)?.label || job.jobType;
      const daysInStatus = Math.floor(
        (Date.now() - new Date(job.statusChangedAt).getTime()) / (1000 * 60 * 60 * 24),
      );

      return `AI summaries are disabled. Job ${job.orderId} is ${jobTypeLabel} in status “${statusLabel}” (${daysInStatus} day(s)).`;
    }

    // Fetch comments
    const comments = await storage.getJobComments(jobId);

    // Fetch status history
    const statusHistory = await db
      .select({
        oldStatus: jobStatusHistory.oldStatus,
        newStatus: jobStatusHistory.newStatus,
        changedAt: jobStatusHistory.changedAt,
        changedBy: {
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobStatusHistory)
      .innerJoin(users, eq(users.id, jobStatusHistory.changedBy))
      .where(eq(jobStatusHistory.jobId, jobId))
      .orderBy(jobStatusHistory.changedAt);

    // Build context for AI
    const context = buildJobContext(job, comments, statusHistory, officeSettings);

    // Generate summary using OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an assistant that summarizes job orders for an optometry practice. 
Your goal is to provide a clear, concise summary of the job's current state, highlighting:
- Current status and what it means
- Any issues or delays mentioned in comments
- Important updates or next steps
- Who flagged/marked this job as important and when

Keep the summary brief (2-4 sentences) and professional. Focus on what staff need to know at a glance.`,
        },
        {
          role: "user",
          content: context,
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const summary = response.choices[0]?.message?.content || "Unable to generate summary.";
    return summary;
  } catch (error) {
    console.error("Error generating job summary:", error);
    throw error;
  }
}

function buildJobContext(
  job: Job,
  comments: JobCommentWithAuthor[],
  statusHistory: StatusHistoryEntry[],
  officeSettings: any
): string {
  const patientName = `${job.patientFirstInitial}. ${job.patientLastName}`;
  
  // Get job type label
  const jobTypeLabel = officeSettings?.customJobTypes?.find((t: any) => t.id === job.jobType)?.label || job.jobType;
  
  // Get status label
  const statusLabel = officeSettings?.customStatuses?.find((s: any) => s.id === job.status)?.label || job.status;
  
  // Get destination label
  const destinationLabel = officeSettings?.destinations?.find((d: any) => d.id === job.orderDestination)?.label || job.orderDestination;

  // Calculate days in current status
  const daysInStatus = Math.floor(
    (Date.now() - new Date(job.statusChangedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  let context = `Job Order: ${job.orderId}
Patient: ${patientName}
Job Type: ${jobTypeLabel}
Current Status: ${statusLabel} (for ${daysInStatus} days)
Destination: ${destinationLabel}
Created: ${new Date(job.createdAt).toLocaleDateString()}
`;

  if (job.notes) {
    context += `\nNotes: ${job.notes}`;
  }

  if (statusHistory.length > 0) {
    context += `\n\nStatus History (${statusHistory.length} changes):`;
    statusHistory.slice(-5).forEach((entry) => {
      const changeDesc = entry.oldStatus 
        ? `${entry.oldStatus} → ${entry.newStatus}`
        : `Created as ${entry.newStatus}`;
      context += `\n- ${changeDesc} by ${entry.changedBy.firstName} ${entry.changedBy.lastName} on ${new Date(entry.changedAt).toLocaleDateString()}`;
    });
  }

  if (comments.length > 0) {
    context += `\n\nComments (${comments.length} total):`;
    comments.slice(-5).forEach((comment) => {
      const overdueFlag = comment.isOverdueComment ? " [OVERDUE]" : "";
      context += `\n- ${comment.author.firstName} ${comment.author.lastName}${overdueFlag}: "${comment.content}" (${new Date(comment.createdAt).toLocaleDateString()})`;
    });
  }

  return context;
}

export async function checkAndRegenerateSummary(jobId: string): Promise<void> {
  try {
    console.log(`[AI Summary] Checking if summary needs regeneration for job ${jobId}`);
    
    // Get all flag records for this job
    const flags = await db
      .select({
        userId: jobFlags.userId,
        summaryGeneratedAt: jobFlags.summaryGeneratedAt,
      })
      .from(jobFlags)
      .where(eq(jobFlags.jobId, jobId));

    if (flags.length === 0) {
      console.log(`[AI Summary] Job ${jobId} is not flagged, skipping regeneration`);
      return;
    }
    
    console.log(`[AI Summary] Found ${flags.length} flag(s) for job ${jobId}`);

    // Get the latest status change timestamp
    const latestStatusChange = await db
      .select({ changedAt: jobStatusHistory.changedAt })
      .from(jobStatusHistory)
      .where(eq(jobStatusHistory.jobId, jobId))
      .orderBy(desc(jobStatusHistory.changedAt))
      .limit(1);

    // Get the latest comment timestamp
    const latestComment = await db
      .select({ createdAt: jobComments.createdAt })
      .from(jobComments)
      .where(eq(jobComments.jobId, jobId))
      .orderBy(desc(jobComments.createdAt))
      .limit(1);

    // Find the most recent activity timestamp
    let mostRecentActivity: Date | null = null;
    if (latestStatusChange[0]) {
      mostRecentActivity = new Date(latestStatusChange[0].changedAt);
    }
    if (latestComment[0]) {
      const commentDate = new Date(latestComment[0].createdAt);
      if (!mostRecentActivity || commentDate > mostRecentActivity) {
        mostRecentActivity = commentDate;
      }
    }

    // Get job to get office settings
    const job = await storage.getJob(jobId);
    if (!job) return;

    const office = await storage.getOffice(job.officeId);

    // Regenerate summary for each user who flagged this job if needed
    for (const flag of flags) {
      const needsRegeneration = !flag.summaryGeneratedAt || 
        (mostRecentActivity && new Date(flag.summaryGeneratedAt) < mostRecentActivity);

      console.log(`[AI Summary] Flag for user ${flag.userId}: summaryGeneratedAt=${flag.summaryGeneratedAt}, mostRecentActivity=${mostRecentActivity}, needsRegeneration=${needsRegeneration}`);

      if (needsRegeneration) {
        console.log(`[AI Summary] Regenerating summary for user ${flag.userId} on job ${jobId}`);
        const summary = await generateJobSummary(jobId, office?.settings || {});
        await storage.updateJobFlagSummary(flag.userId, jobId, summary);
        console.log(`[AI Summary] Summary regenerated successfully for user ${flag.userId}`);
      }
    }
  } catch (error) {
    console.error("[AI Summary] Error checking/regenerating summary:", error);
    // Don't throw - summary regeneration is not critical for the main operation
  }
}
