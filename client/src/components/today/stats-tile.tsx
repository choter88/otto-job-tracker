import { useQuery } from "@tanstack/react-query";
import type { Job } from "@shared/schema";

export default function StatsTile({ jobs }: { jobs: Job[] }) {
  const { data: overdue = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/overdue"] });
  const { data: starred = [] } = useQuery<any[]>({ queryKey: ["/api/jobs/flagged"] });
  const ready = jobs.filter((j) => j.status === "ready_for_pickup").length;
  const oldest = jobs.reduce((m, j) => Math.max(m, Date.now() - new Date(j.statusChangedAt as any).getTime()), 0);
  const oldestDays = Math.floor(oldest / 86400000);
  const stat = (n: number | string, label: string) => (
    <div className="flex items-baseline gap-2"><span className="font-semibold text-lg text-ink tabular-nums">{n}</span><span className="text-xs text-ink-mute">{label}</span></div>
  );
  return (
    <section className="rounded-xl border border-line bg-panel p-4 grid grid-cols-2 gap-3">
      {stat(ready, "ready to call")}
      {stat(overdue.length, "overdue")}
      {stat(jobs.length, "open backlog")}
      {stat(starred.length, "starred")}
      {stat(`${oldestDays}d`, "oldest job")}
    </section>
  );
}
