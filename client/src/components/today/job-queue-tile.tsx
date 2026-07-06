import { useState } from "react";
import { useLocation } from "wouter";
import { Phone, Clock } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { selectQueueJobs, type SlotConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";
import CallLabButton from "@/components/today/call-lab-button";
import SnoozeButton from "@/components/today/snooze-button";

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

  return (
    <section className="flex-1 min-h-0 rounded-xl border border-line bg-panel overflow-hidden flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2 flex-none">
        {isChase
          ? <Clock className="h-3.5 w-3.5 text-warn flex-none" />
          : <Phone className="h-3.5 w-3.5 text-success flex-none" />}
        <span className="font-semibold text-sm text-ink">{slot.title ?? "Call patients"}</span>
        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full ${isChase ? "bg-warn-bg text-warn" : "bg-success-bg text-success"}`}>{queued.length}</span>
        <button className="ml-auto text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="today-tile-edit">Edit</button>
      </header>
      {queued.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6 text-center text-sm text-ink-mute">Nothing here right now.</div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {isChase
            ? queued.map((job, i) => (
                <ChaseRow
                  key={job.id}
                  job={job}
                  office={office}
                  first={i === 0}
                  lastComment={lastOverdue[job.id]}
                  onOpen={() => onOpenJob(job, "comments", true)}
                  onPhoneSaved={() => {}}
                />
              ))
            : queued.map((job, i) => (
                <OutreachRow key={job.id} job={job} office={office} first={i === 0} onOpen={() => onOpenJob(job, "comments")} />
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

function OutreachRow({ job, office, first, onOpen }: { job: Job; office: any; first: boolean; onOpen: () => void }) {
  const typeStyle = getTypeBadgeStyle(job.jobType, office?.settings?.customJobTypes ?? []);
  const readyFor = formatDistanceToNow(new Date(job.statusChangedAt as any), { addSuffix: false });
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen} data-testid={`today-row-${job.id}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: typeStyle.background, color: typeStyle.text }}>{job.jobType}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1">Ready {readyFor}</div>
      </button>
      <StampButtons jobId={job.id} />
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

function ChaseRow({ job, office, first, lastComment, onOpen, onPhoneSaved }:
  { job: Job; office: any; first: boolean; lastComment?: any; onOpen: () => void; onPhoneSaved: () => void }) {
  const destStyle = getDestinationBadgeStyle(job.orderDestination, office?.settings?.customOrderDestinations ?? []);
  const statusLabel = (office?.settings?.customStatuses ?? []).find((s: any) => s.id === job.status)?.label ?? job.status;
  const days = Math.floor((Date.now() - new Date(job.statusChangedAt as any).getTime()) / 86400000);
  const lab = (office?.settings?.customOrderDestinations ?? []).find((d: any) => d.id === job.orderDestination);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${first ? "" : "border-t border-line-2"}`}>
      <button className="flex-1 min-w-0 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-ink">{job.patientFirstName} {job.patientLastName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: destStyle.background, color: destStyle.text }}>{lab?.label ?? job.orderDestination}</span>
        </div>
        <div className="text-xs text-ink-mute mt-1 truncate">
          {statusLabel}{lastComment ? ` · "${lastComment.content}"` : " · no overdue note yet"}
        </div>
      </button>
      <div className="flex-none w-24 text-right">
        <div className="font-mono text-sm text-danger">{days} days</div>
        <div className="text-[10px] text-ink-mute">in status</div>
      </div>
      <div className="flex-none flex gap-2">
        <CallLabButton lab={lab} job={job} office={office} onPhoneSaved={onPhoneSaved} />
        <Button size="xs" variant="outline" onClick={onOpen} data-testid={`chase-comments-${job.id}`}>Comments</Button>
        <SnoozeButton jobId={job.id} />
      </div>
    </div>
  );
}

function StampButtons({ jobId }: { jobId: string }) {
  return (
    <div className="flex-none flex gap-2">
      <StampButton jobId={jobId} kind="Called" />
      <StampButton jobId={jobId} kind="Texted" />
    </div>
  );
}

// One outreach action. Click opens a popover for an optional note, then logs a
// comment. After logging, the button shows the date; clicking again opens the
// popover for another note and logs a second instance (no undo — each tap is a
// real, kept record).
function StampButton({ jobId, kind }: { jobId: string; kind: "Called" | "Texted" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stampedAt, setStampedAt] = useState<Date | null>(null);

  const post = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const id = `stamp-${jobId}-${kind}-${now.getTime()}`;
      const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const content = note.trim() ? `${kind} — ${time} · ${note.trim()}` : `${kind} — ${time}`;
      await apiRequest("POST", `/api/jobs/${jobId}/comments`, { id, content });
      return now;
    },
    onSuccess: (now) => {
      setStampedAt(now);
      setNote("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/jobs", jobId, "comments"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/comment-counts"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/unread-comments"] });
    },
  });

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNote(""); }}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant={stampedAt ? "secondary" : "outline"}
          data-testid={`stamp-${kind.toLowerCase()}-${jobId}`}
        >
          {stampedAt ? `✓ ${kind} ${format(stampedAt, "MMM d")}` : kind}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-xs font-medium text-ink mb-2">Log {kind.toLowerCase()} — add a note?</div>
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !post.isPending) post.mutate(); }}
          placeholder="optional note…"
          className="w-full text-xs px-2 py-1.5 rounded border border-line-2 bg-paper"
          data-testid={`stamp-note-${kind.toLowerCase()}-${jobId}`}
        />
        <div className="flex justify-end gap-2 mt-2.5">
          <Button size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={post.isPending}>Cancel</Button>
          <Button size="xs" onClick={() => post.mutate()} disabled={post.isPending} data-testid={`stamp-log-${kind.toLowerCase()}-${jobId}`}>
            Log {kind}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
