import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Phone, Clock } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getTypeBadgeStyle } from "@/lib/default-colors";
import { selectQueueJobs, type SlotConfig } from "@shared/today-defaults";
import { formatAttemptSummary, type AttemptSummary } from "@shared/attempt-summary";
import { getJobTypeLabel, getDestination, getNextStatus, formatDaysInStatus } from "@shared/job-labels";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";
import CallLabButton from "@/components/today/call-lab-button";
import SnoozeButton from "@/components/today/snooze-button";
import { TODAY_DENSITY } from "@/components/today/today-density";

interface Props {
  slot: SlotConfig;
  jobs: Job[];
  office: any;
  onOpenJob: (job: Job, tab: JobDetailsTab, overdue?: boolean) => void; // overdue flag added in Task 9
  onEdit: () => void;
}

// Orders the Overdue list by status ORDER (shared/office-defaults.ts'
// customStatuses[].order field, ascending: earliest lifecycle step first),
// tie-broken by longest-in-status first (largest formatDaysInStatus) so the
// worst job within a status leads. Unknown status ids sort last.
function sortOverdueJobs(jobs: Job[], office: any, nowMs: number = Date.now()): Job[] {
  const customStatuses = office?.settings?.customStatuses ?? [];
  const orderOf = (statusId: string): number => {
    const match = customStatuses.find((s: any) => s.id === statusId);
    return match ? match.order : Number.POSITIVE_INFINITY;
  };
  return [...jobs].sort((a, b) => {
    const orderDiff = orderOf(a.status) - orderOf(b.status);
    if (orderDiff !== 0) return orderDiff;
    return formatDaysInStatus(b.statusChangedAt as any, nowMs) - formatDaysInStatus(a.statusChangedAt as any, nowMs);
  });
}

export default function JobQueueTile({ slot, jobs, office, onOpenJob, onEdit }: Props) {
  const [, setLocation] = useLocation();
  const isChase = slot.mode === "chase";

  // Outreach mode keeps its existing client-side selection over /api/jobs.
  const queued = selectQueueJobs(jobs, slot.statusIds ?? []);

  // Chase mode ("Overdue" card) sources the deduped overdue list straight
  // from the server (getOverdueJobs), not a client-side selectQueueJobs
  // filter over /api/jobs. Flat + status-ordered, no holder grouping.
  const { data: rawOverdue = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs/overdue"],
    enabled: isChase,
  });
  const overdueJobs = isChase ? sortOverdueJobs(rawOverdue, office) : [];

  const displayed = isChase ? overdueJobs : queued;

  const overdueIds = overdueJobs.map((j) => j.id).join(",");
  const { data: lastOverdue = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/jobs/overdue-comments", overdueIds],
    queryFn: async () => {
      if (!overdueIds) return {};
      const res = await fetch(`/api/jobs/overdue-comments?jobIds=${encodeURIComponent(overdueIds)}`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: isChase && overdueIds.length > 0,
  });

  const queuedOrderIds = queued.map((j) => j.orderId).join(",");
  const { data: attemptSummaries = {} } = useQuery<Record<string, AttemptSummary>>({
    queryKey: ["/api/jobs/attempt-summaries", queuedOrderIds],
    queryFn: async () => {
      if (!queuedOrderIds) return {};
      const res = await fetch(`/api/jobs/attempt-summaries?jobOrderIds=${encodeURIComponent(queuedOrderIds)}`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: !isChase && queuedOrderIds.length > 0,
  });

  return (
    <section className="flex-1 min-h-0 rounded-xl border border-line bg-panel overflow-hidden flex flex-col">
      <header className={`flex items-center gap-2 ${TODAY_DENSITY.header} border-b border-line-2 flex-none`}>
        {isChase
          ? <Clock className="h-3.5 w-3.5 text-warn flex-none" />
          : <Phone className="h-3.5 w-3.5 text-success flex-none" />}
        <span className="font-semibold text-sm text-ink">{slot.title ?? (isChase ? "Overdue" : "Call patients ready for pickup")}</span>
        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full ${isChase ? "bg-warn-bg text-warn" : "bg-success-bg text-success"}`}>{displayed.length}</span>
        <button className="ml-auto text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="today-tile-edit">Edit</button>
      </header>
      {displayed.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6 text-center text-sm text-ink-mute">Nothing here right now.</div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {isChase
            ? overdueJobs.map((job, i) => (
                <OverdueRow
                  key={job.id}
                  job={job}
                  office={office}
                  first={i === 0}
                  lastComment={lastOverdue[job.id]}
                  onOpen={() => onOpenJob(job, "comments", true)}
                />
              ))
            : queued.map((job, i) => (
                <OutreachRow
                  key={job.id}
                  job={job}
                  office={office}
                  first={i === 0}
                  summary={attemptSummaries[job.orderId]}
                  onOpen={() => onOpenJob(job, "comments")}
                />
              ))
          }
        </ScrollArea>
      )}
      {displayed.length > 0 && (
        <button
          className="flex-none border-t border-line-2 px-4 py-2 text-xs text-otto-accent hover:bg-panel-2 text-center"
          onClick={() => {
            // Overdue spans multiple statuses, so a single status filter
            // doesn't apply there; send it to the unfiltered worklist.
            // The outreach (ready-for-pickup) card filters to its slot's
            // status so "View all" opens the worklist pre-filtered.
            if (isChase) {
              setLocation("/dashboard/all");
              return;
            }
            const readyStatusId = slot.statusIds?.[0];
            setLocation(readyStatusId ? `/dashboard/all?status=${encodeURIComponent(readyStatusId)}` : "/dashboard/all");
          }}
          data-testid="today-view-all"
        >
          View all {displayed.length} {slot.mode === "chase" ? "overdue" : "ready for pickup"} →
        </button>
      )}
    </section>
  );
}

function OutreachRow({ job, office, first, summary, onOpen }:
  { job: Job; office: any; first: boolean; summary?: AttemptSummary; onOpen: () => void }) {
  const typeStyle = getTypeBadgeStyle(job.jobType, office?.settings?.customJobTypes ?? []);
  const typeLabel = getJobTypeLabel(job.jobType, office);
  const statusLabel = (office?.settings?.customStatuses ?? []).find((s: any) => s.id === job.status)?.label ?? job.status;
  const days = formatDaysInStatus(job.statusChangedAt as any);
  return (
    <div className={`flex items-center gap-4 ${TODAY_DENSITY.row} ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen} data-testid={`today-row-${job.id}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink leading-tight">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded leading-tight" style={{ background: typeStyle.background, color: typeStyle.text }}>{typeLabel}</span>
        </div>
        <div className={`text-xs text-ink-mute leading-tight ${TODAY_DENSITY.lineGap}`}>
          {statusLabel} · {days} days
        </div>
        {summary && summary.count > 0 && (
          <div className={`text-xs text-ink-mute leading-tight ${TODAY_DENSITY.lineGapTight}`} data-testid={`attempt-summary-${job.id}`}>
            {formatAttemptSummary(summary)}
          </div>
        )}
      </button>
      <ContactButtons job={job} />
      <PickedUpButton jobId={job.id} />
      <SnoozeButton jobId={job.id} />
    </div>
  );
}

// Advances the job through the normal state machine (no shortcut): the same
// PUT the rest of the app uses to mark a job completed. On success the row
// leaves the tile on its own because the job is no longer ready-for-pickup.
function PickedUpButton({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const pickUp = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/jobs/${jobId}`, { status: "completed" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/today/activity"] });
      toast({ title: "Job marked picked up." });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't mark this picked up", description: e?.message, variant: "destructive" });
    },
  });

  return (
    <Button
      size="xs"
      disabled={pickUp.isPending}
      onClick={() => pickUp.mutate()}
      data-testid={`picked-up-${jobId}`}
    >
      Picked up
    </Button>
  );
}

// One row in the Overdue card: patient + job type, status/days line, an
// optional last-note line, and its row actions (Advance, Call, Comments,
// Snooze). Replaces the old holder-grouped ChaseGroup/ChaseRow: every job
// gets its own Call action (no shared group-header call), and Advance moves
// the job forward through the normal state-machine PUT.
function OverdueRow({ job, office, first, lastComment, onOpen }:
  { job: Job; office: any; first: boolean; lastComment?: any; onOpen: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const typeStyle = getTypeBadgeStyle(job.jobType, office?.settings?.customJobTypes ?? []);
  const typeLabel = getJobTypeLabel(job.jobType, office);
  const statusLabel = (office?.settings?.customStatuses ?? []).find((s: any) => s.id === job.status)?.label ?? job.status;
  const days = formatDaysInStatus(job.statusChangedAt as any);
  const destination = getDestination(job.orderDestination, office);

  // Logs a chase for this one job, mirroring how the old holder-group Call
  // wired its onCalled (POST /api/jobs/chase), just scoped to a single
  // jobOrderId instead of the whole group's.
  const chase = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/jobs/chase", {
        jobOrderIds: [job.orderId],
        destinationId: job.orderDestination,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/today/activity"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't log this chase", description: e?.message, variant: "destructive" });
    },
  });

  return (
    <div className={`flex items-center gap-4 ${TODAY_DENSITY.row} ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink leading-tight">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded leading-tight" style={{ background: typeStyle.background, color: typeStyle.text }}>{typeLabel}</span>
        </div>
        <div className={`text-xs text-ink-mute leading-tight truncate ${TODAY_DENSITY.lineGap}`}>
          {statusLabel} · {days} days
        </div>
        {lastComment && (
          <div className={`text-xs text-ink-mute leading-tight truncate ${TODAY_DENSITY.lineGapTight}`}>"{lastComment.content}"</div>
        )}
      </button>
      <div className="flex-none flex gap-2">
        <AdvanceButton job={job} office={office} />
        {job.status !== "job_created" && destination && (
          <CallLabButton
            lab={destination}
            job={job}
            office={office}
            onPhoneSaved={() => {}}
            onCalled={() => chase.mutate()}
          />
        )}
        <Button size="xs" variant="outline" onClick={onOpen} data-testid={`chase-comments-${job.id}`}>Comments</Button>
        <SnoozeButton jobId={job.id} />
      </div>
    </div>
  );
}

// Advances the job through the normal state machine (no shortcut): the same
// PUT the rest of the app uses for any status change. Disabled when the job
// is already at its last status (getNextStatus returns null).
function AdvanceButton({ job, office }: { job: Job; office: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const next = getNextStatus(job.status, office);

  const advance = useMutation({
    mutationFn: async () => {
      if (!next) return;
      await apiRequest("PUT", `/api/jobs/${job.id}`, { status: next.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
      qc.invalidateQueries({ queryKey: ["/api/today/activity"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't advance this job", description: e?.message, variant: "destructive" });
    },
  });

  return (
    <Button
      size="xs"
      disabled={!next || advance.isPending}
      onClick={() => advance.mutate()}
      title={next ? `Advance to ${next.label}` : "Already at the last status"}
      data-testid={`advance-${job.id}`}
    >
      Advance
    </Button>
  );
}

function ContactButtons({ job }: { job: Job }) {
  return (
    <div className="flex-none flex gap-2">
      <ContactButton job={job} kind="Call" />
      <ContactButton job={job} kind="Text" />
    </div>
  );
}

// One present-tense contact action. Click fires the deep link (tel:/sms:)
// immediately, then logs a structured attempt event server-side so the row's
// summary line and job history carry attribution. Shows a brief "✓ Called" /
// "✓ Texted" confirmation, then reverts to "Call"/"Text" so the button stays
// usable for a repeat attempt (no claiming/assignment UI; attribution flows
// through the attempt event alone).
function ContactButton({ job, kind }: { job: Job; kind: "Call" | "Text" }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!confirmed) return;
    const t = setTimeout(() => setConfirmed(false), 2000);
    return () => clearTimeout(t);
  }, [confirmed]);

  const attemptType = kind === "Call" ? "called" : "texted";

  const logAttempt = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/jobs/${job.id}/attempts`, { type: attemptType });
    },
    onSuccess: () => {
      setConfirmed(true);
      qc.invalidateQueries({ queryKey: ["/api/jobs/attempt-summaries"] });
      qc.invalidateQueries({ queryKey: ["/api/today/activity"] });
    },
    onError: (e: any) => {
      toast({ title: `Couldn't log this ${kind.toLowerCase()}`, description: e?.message, variant: "destructive" });
    },
  });

  const hasPhone = !!job.phone?.trim();

  const handleClick = () => {
    if (!hasPhone) return;
    window.location.href = kind === "Call" ? `tel:${job.phone}` : `sms:${job.phone}`;
    logAttempt.mutate();
  };

  return (
    <Button
      size="xs"
      variant={confirmed ? "secondary" : "outline"}
      onClick={handleClick}
      disabled={!hasPhone || logAttempt.isPending}
      title={hasPhone ? undefined : "No phone on file"}
      data-testid={`contact-${kind.toLowerCase()}-${job.id}`}
    >
      {confirmed ? `✓ ${kind === "Call" ? "Called" : "Texted"}` : kind}
    </Button>
  );
}
