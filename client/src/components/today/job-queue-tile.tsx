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
import { getJobTypeLabel, formatDaysInStatus } from "@shared/job-labels";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";
import CallLabButton from "@/components/today/call-lab-button";
import SnoozeButton from "@/components/today/snooze-button";
import { groupByHolder, type HolderGroup } from "@/components/today/today-holder-groups";

interface Props {
  slot: SlotConfig;
  jobs: Job[];
  office: any;
  onOpenJob: (job: Job, tab: JobDetailsTab, overdue?: boolean) => void; // overdue flag added in Task 9
  onEdit: () => void;
}

export default function JobQueueTile({ slot, jobs, office, onOpenJob, onEdit }: Props) {
  const [, setLocation] = useLocation();
  const queued = selectQueueJobs(jobs, slot.statusIds ?? []);

  const isChase = slot.mode === "chase";
  const holderGroups = isChase ? groupByHolder(queued, office) : [];
  const queuedIds = queued.map((j) => j.id).join(",");
  const { data: lastOverdue = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/jobs/overdue-comments", queuedIds],
    queryFn: async () => {
      if (!queuedIds) return {};
      const res = await fetch(`/api/jobs/overdue-comments?jobIds=${encodeURIComponent(queuedIds)}`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: isChase && queuedIds.length > 0,
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
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2 flex-none">
        {isChase
          ? <Clock className="h-3.5 w-3.5 text-warn flex-none" />
          : <Phone className="h-3.5 w-3.5 text-success flex-none" />}
        <span className="font-semibold text-sm text-ink">{slot.title ?? (isChase ? "Needs attention" : "Call patients ready for pickup")}</span>
        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full ${isChase ? "bg-warn-bg text-warn" : "bg-success-bg text-success"}`}>{queued.length}</span>
        <button className="ml-auto text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="today-tile-edit">Edit</button>
      </header>
      {queued.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6 text-center text-sm text-ink-mute">Nothing here right now.</div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {isChase
            ? holderGroups.map((group, gi) => (
                <ChaseGroup
                  key={group.key}
                  group={group}
                  office={office}
                  first={gi === 0}
                  lastOverdue={lastOverdue}
                  onOpenJob={(job) => onOpenJob(job, "comments", true)}
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
      {queued.length > 0 && (
        <button
          className="flex-none border-t border-line-2 px-4 py-2 text-xs text-otto-accent hover:bg-panel-2 text-center"
          onClick={() => setLocation(slot.mode === "chase" ? "/dashboard/overdue" : "/dashboard/all")}
          data-testid="today-view-all"
        >
          View all {queued.length} {slot.mode === "chase" ? "overdue" : "ready for pickup"} →
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
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen} data-testid={`today-row-${job.id}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: typeStyle.background, color: typeStyle.text }}>{typeLabel}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1">
          {statusLabel} · {days} days
        </div>
        {summary && summary.count > 0 && (
          <div className="text-xs text-ink-mute mt-0.5" data-testid={`attempt-summary-${job.id}`}>
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

// One holder group in the "Needs attention" tile: a header identifying who
// currently has the job (a lab, or "In office" for jobs not yet sent out),
// followed by its rows worst-first. Lab group headers carry the single Call
// action for the whole group; "In office" has no call (nothing to dial).
function ChaseGroup({ group, office, first, lastOverdue, onOpenJob }: {
  group: HolderGroup;
  office: any;
  first: boolean;
  lastOverdue: Record<string, any>;
  onOpenJob: (job: Job) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const chase = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/jobs/chase", {
        jobOrderIds: group.jobs.map((j: Job) => j.orderId),
        destinationId: group.destinationId,
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

  const lab = group.kind === "lab" ? { id: group.destinationId!, label: group.label, phone: group.phone } : undefined;

  return (
    <div className={first ? "" : "border-t border-line-2"}>
      <div className="flex items-center gap-2 px-4 py-2 bg-panel-2">
        <span className="font-semibold text-xs text-ink">{group.label}</span>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-warn-bg text-warn">{group.jobs.length}</span>
        {group.kind === "lab" && (
          <div className="ml-auto">
            <CallLabButton
              lab={lab}
              id={group.key}
              office={office}
              onPhoneSaved={() => {}}
              onCalled={() => chase.mutate()}
            />
          </div>
        )}
      </div>
      {group.jobs.map((job: Job, i: number) => (
        <ChaseRow
          key={job.id}
          job={job}
          office={office}
          first={i === 0}
          lastComment={lastOverdue[job.id]}
          onOpen={() => onOpenJob(job)}
        />
      ))}
    </div>
  );
}

function ChaseRow({ job, office, first, lastComment, onOpen }:
  { job: Job; office: any; first: boolean; lastComment?: any; onOpen: () => void }) {
  const typeStyle = getTypeBadgeStyle(job.jobType, office?.settings?.customJobTypes ?? []);
  const typeLabel = getJobTypeLabel(job.jobType, office);
  const statusLabel = (office?.settings?.customStatuses ?? []).find((s: any) => s.id === job.status)?.label ?? job.status;
  const days = formatDaysInStatus(job.statusChangedAt as any);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: typeStyle.background, color: typeStyle.text }}>{typeLabel}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1 truncate">
          {statusLabel} · {days} days
        </div>
        {lastComment && (
          <div className="text-xs text-ink-mute mt-0.5 truncate">"{lastComment.content}"</div>
        )}
      </button>
      <div className="flex-none flex gap-2">
        <Button size="xs" variant="outline" onClick={onOpen} data-testid={`chase-comments-${job.id}`}>Comments</Button>
        <SnoozeButton jobId={job.id} />
      </div>
    </div>
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
// usable for a repeat attempt (no claiming/assignment UI — attribution flows
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
