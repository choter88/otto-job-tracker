import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { selectQueueJobs, type SlotConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";
import CallLabButton from "@/components/today/call-lab-button";

interface Props {
  slot: SlotConfig;
  jobs: Job[];
  office: any;
  onOpenJob: (job: Job, tab: JobDetailsTab, overdue?: boolean) => void; // overdue flag added in Task 9
  onEdit: () => void;
}

const MAX_ROWS = 12;

export default function JobQueueTile({ slot, jobs, office, onOpenJob, onEdit }: Props) {
  const [, setLocation] = useLocation();
  const queued = selectQueueJobs(jobs, slot.statusIds ?? []);
  const visible = queued.slice(0, MAX_ROWS);

  const isChase = slot.mode === "chase";
  const visibleIds = visible.map((j) => j.id).join(",");
  const { data: lastOverdue = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/jobs/overdue-comments", visibleIds],
    queryFn: async () => {
      if (!visibleIds) return {};
      const res = await fetch(`/api/jobs/overdue-comments?jobIds=${encodeURIComponent(visibleIds)}`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: isChase && visibleIds.length > 0,
  });

  return (
    <section>
      <header className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-[15px] text-ink">{slot.title ?? "Call patients"}</span>
        <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-success-bg text-success">{queued.length}</span>
        <button className="ml-auto text-xs text-ink-mute hover:text-ink" onClick={onEdit} data-testid="today-tile-edit">Edit</button>
      </header>
      <div className="rounded-xl border border-line bg-panel overflow-hidden">
        {visible.length === 0 && <div className="p-6 text-center text-sm text-ink-mute">Nothing here right now.</div>}
        {isChase
          ? visible.map((job, i) => (
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
          : visible.map((job, i) => (
              <OutreachRow key={job.id} job={job} office={office} first={i === 0} onOpen={() => onOpenJob(job, "comments")} />
            ))
        }
      </div>
      {queued.length > 0 && (
        <button
          className="block mx-auto mt-2 text-xs text-accent hover:underline"
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
    </div>
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
      </div>
    </div>
  );
}

function StampButtons({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  // ponytail: undo state is in-memory (the comment id we just created), so a
  // stamp can be undone within this view but not after a remount — fine for an
  // immediate "oops" correction; the comment is always editable in the modal.
  const [stamps, setStamps] = useState<{ called?: string; texted?: string }>({});

  const post = useMutation({
    mutationFn: async (kind: "Called" | "Texted") => {
      const id = `stamp-${jobId}-${kind}-${Date.now()}`;
      const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const content = note.trim() ? `${kind} — ${time} · ${note.trim()}` : `${kind} — ${time}`;
      await apiRequest("POST", `/api/jobs/${jobId}/comments`, { id, content });
      return { kind, id };
    },
    onSuccess: ({ kind, id }) => {
      setStamps((s) => ({ ...s, [kind.toLowerCase()]: id }));
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/jobs", jobId, "comments"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/comment-counts"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/unread-comments"] });
    },
  });

  const undo = useMutation({
    mutationFn: async (commentId: string) => { await apiRequest("DELETE", `/api/jobs/comments/${commentId}`); },
    onSuccess: (_d, commentId) => {
      setStamps((s) => (s.called === commentId ? { ...s, called: undefined } : { ...s, texted: undefined }));
      qc.invalidateQueries({ queryKey: ["/api/jobs", jobId, "comments"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs/comment-counts"] });
    },
  });

  const busy = post.isPending || undo.isPending;
  const toggle = (kind: "Called" | "Texted") => {
    if (busy) return;
    const existing = kind === "Called" ? stamps.called : stamps.texted;
    if (existing) undo.mutate(existing);
    else post.mutate(kind);
  };

  return (
    <div className="flex-none flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button size="xs" variant={stamps.called ? "secondary" : "outline"} disabled={busy} onClick={() => toggle("Called")} data-testid={`stamp-called-${jobId}`}>
          {stamps.called ? "✓ Called" : "Called"}
        </Button>
        <Button size="xs" variant={stamps.texted ? "secondary" : "outline"} disabled={busy} onClick={() => toggle("Texted")} data-testid={`stamp-texted-${jobId}`}>
          {stamps.texted ? "✓ Texted" : "Texted"}
        </Button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="optional note…"
        className="text-xs px-2 py-1 rounded border border-line-2 bg-paper w-40"
        data-testid={`stamp-note-${jobId}`}
      />
    </div>
  );
}
