import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityType, ActivityFeedItem } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";

// One component, two uses: scope="me" (Since last login, with Edit) and
// scope="office" (Team activity, no Edit) — see Task 12.
export default function ActivityTile({
  filter,
  jobsById,
  onOpenJob,
  onEdit,
  scope = "me",
  title = "Since last login",
}: {
  filter: ActivityType[];
  jobsById: Map<string, Job>;
  onOpenJob: (job: Job, tab: JobDetailsTab) => void;
  onEdit?: () => void;
  scope?: "me" | "office";
  title?: string;
}) {
  const types = filter.join(",");
  const { data } = useQuery<{ since: number; items: ActivityFeedItem[] }>({
    queryKey: ["/api/today/activity", scope, types],
    queryFn: async () => {
      const res = await fetch(
        `/api/today/activity?scope=${scope}&types=${encodeURIComponent(types)}`,
        { credentials: "include" },
      );
      return res.ok ? res.json() : { since: Date.now(), items: [] };
    },
  });
  const items = data?.items ?? [];
  return (
    <section className="flex-1 min-h-0 rounded-xl border border-line bg-panel overflow-hidden flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <MessageSquare className="h-3.5 w-3.5 text-accent" />
        <span className="font-semibold text-sm text-ink">{title}</span>
        {scope === "me" && data?.since ? (
          <span className="ml-auto text-[10px] font-mono text-ink-mute">
            {formatDistanceToNow(new Date(data.since), { addSuffix: true })}
          </span>
        ) : null}
        {onEdit && (
          <button
            className="ml-2 text-xs text-ink-mute hover:text-ink"
            onClick={onEdit}
            data-testid="activity-edit"
          >
            Edit
          </button>
        )}
      </header>
      <ScrollArea className="flex-1 min-h-0">
        {items.length === 0 && (
          <div className="p-5 text-center text-sm text-ink-mute">
            Nothing new since you were last here.
          </div>
        )}
        {items.map((it) => {
          const job = jobsById.get(it.jobId);
          return (
            <button
              key={it.id}
              className="w-full text-left flex gap-3 px-4 py-2.5 border-b border-line-2 last:border-0 hover:bg-panel-2"
              onClick={() =>
                job && onOpenJob(job, it.type === "comment" ? "comments" : "overview")
              }
              data-testid={`activity-${it.id}`}
            >
              <span className="w-7 h-7 rounded-full bg-paper-2 text-ink-2 text-[11px] font-semibold grid place-items-center flex-none">
                {it.actor
                  ? `${it.actor.firstName[0] ?? ""}${it.actor.lastName[0] ?? ""}`
                  : "·"}
              </span>
              {/* Two rows only: actor/verb/job + right-justified time on row 1,
                  the note/detail truncated to a single line on row 2. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-ink-2 truncate min-w-0 flex-1">
                    {it.actor ? (
                      <strong className="text-ink">{it.actor.firstName}</strong>
                    ) : (
                      <strong className="text-ink">A job</strong>
                    )}{" "}
                    {it.verb} <strong className="text-ink">{it.jobLabel}</strong>
                  </span>
                  <span className="text-[10px] font-mono text-ink-faint flex-none whitespace-nowrap">
                    {formatDistanceToNow(new Date(it.at), { addSuffix: true })}
                  </span>
                </div>
                {it.detail && (
                  <div className="text-[11px] text-ink-mute mt-0.5 truncate">{it.detail}</div>
                )}
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </section>
  );
}
