import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Check } from "lucide-react";
import { getStatusBadgeStyle } from "@/lib/default-colors";
import { getJobTypeLabel } from "@shared/job-labels";
import { apiRequest } from "@/lib/queryClient";
import { TODAY_EVENTS } from "@shared/today-telemetry";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

// Thin wrapper around POST /api/track for Today Dashboard v2 client events —
// same pattern as client/src/components/topbar.tsx (not shared/exported from
// there; kept local so this tile has no import coupling to the topbar).
// Fire-and-forget — telemetry failures must never break the UI. Metadata is
// numbers/enums only so PHI can never be logged from the client.
function trackTodayEvent(eventType: (typeof TODAY_EVENTS)[keyof typeof TODAY_EVENTS]) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType, metadata: {} }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export default function StarredTile({ office, onOpenJob }:
  { office: any; onOpenJob: (job: Job, tab: JobDetailsTab) => void }) {
  const { data: starred = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/flagged"] });
  const customStatuses = office?.settings?.customStatuses ?? [];
  const queryClient = useQueryClient();

  // req 7: the "done" action unstars the row (same endpoint the job-details
  // modal's unstar control uses) and fires the today_star_done client event.
  // No job_event is created for this — the activity feed doesn't surface
  // star_done, so there's no consumer.
  const doneMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}/flag`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
    },
  });

  const handleDone = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    trackTodayEvent(TODAY_EVENTS.STAR_DONE);
    doneMutation.mutate(jobId);
  };

  return (
    <section className="flex-none rounded-xl border border-line bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <Star className="h-3.5 w-3.5 text-warn" fill="currentColor" />
        <span className="font-semibold text-sm text-ink">Remember</span>
        <span className="ml-auto font-mono text-[10px] px-1.5 rounded-full bg-paper-2 text-ink-mute">{starred.length}</span>
      </header>
      <div className="max-h-72 overflow-y-auto">
        {starred.length === 0 && <div className="p-5 text-center text-sm text-ink-mute">No starred jobs.</div>}
        {starred.map((job) => {
          const st = getStatusBadgeStyle(job.status, customStatuses);
          const statusLabel = customStatuses.find((s: any) => s.id === job.status)?.label ?? job.status;
          const primaryText = job.importantNote || `${job.patientFirstName} ${job.patientLastName}`;
          return (
            <div key={job.id}
              className="group w-full flex items-start gap-2.5 px-4 py-3 border-b border-line-2 last:border-0 hover:bg-panel-2">
              <button className="flex-1 min-w-0 text-left flex items-start gap-2.5"
                onClick={() => onOpenJob(job as Job, "overview")} data-testid={`starred-${job.id}`}>
                <Star className="h-3 w-3 mt-1 text-warn flex-none" fill="currentColor" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink truncate">{primaryText}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-ink-mute truncate">
                      {job.patientFirstName} {job.patientLastName} · {getJobTypeLabel(job.jobType, office)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-none" style={{ background: st.background, color: st.text }}>{statusLabel}</span>
                  </div>
                </div>
              </button>
              <button
                className="flex-none mt-0.5 flex items-center gap-1 text-[11px] text-ink-mute hover:text-ink px-1.5 py-0.5 rounded"
                onClick={(e) => handleDone(e, job.id)}
                data-testid={`starred-done-${job.id}`}
                title="Done"
              >
                <Check className="h-3 w-3" />
                Done
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
