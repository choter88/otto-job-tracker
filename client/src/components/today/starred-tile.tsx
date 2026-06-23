import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getStatusBadgeStyle } from "@/lib/default-colors";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

export default function StarredTile({ office, onOpenJob }:
  { office: any; onOpenJob: (job: Job, tab: JobDetailsTab) => void }) {
  const { data: starred = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/flagged"] });
  const customStatuses = office?.settings?.customStatuses ?? [];
  return (
    <section className="flex-none rounded-xl border border-line bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <Star className="h-3.5 w-3.5 text-warn" fill="currentColor" />
        <span className="font-semibold text-sm text-ink">Remember — starred</span>
        <span className="ml-auto font-mono text-[10px] px-1.5 rounded-full bg-paper-2 text-ink-mute">{starred.length}</span>
      </header>
      <ScrollArea className="max-h-64">
        {starred.length === 0 && <div className="p-5 text-center text-sm text-ink-mute">No starred jobs.</div>}
        {starred.map((job) => {
          const st = getStatusBadgeStyle(job.status, customStatuses);
          const statusLabel = customStatuses.find((s: any) => s.id === job.status)?.label ?? job.status;
          return (
            <button key={job.id} className="w-full text-left flex items-start gap-2.5 px-4 py-3 border-b border-line-2 last:border-0 hover:bg-panel-2"
              onClick={() => onOpenJob(job as Job, "overview")} data-testid={`starred-${job.id}`}>
              <Star className="h-3 w-3 mt-1 text-warn flex-none" fill="currentColor" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-ink">{job.patientFirstName} {job.patientLastName} · {job.jobType}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: st.background, color: st.text }}>{statusLabel}</span>
                </div>
                {job.importantNote && <div className="text-[11px] text-ink-mute mt-0.5 truncate">{job.importantNote}</div>}
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </section>
  );
}
