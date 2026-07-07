import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { capActivityFeed, type ActivityType, type ActivityFeedItem } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import type { JobDetailsTab } from "@/components/job-details-modal";
import { TODAY_DENSITY } from "@/components/today/today-density";

// M8: the only remaining caller is today.tsx's single Team activity feed
// (scope="office", no onEdit; the filter is fixed to TEAM_ACTIVITY_FILTER).
// scope="me" ("Since last login") is kept as a supported mode of this
// component (server-side boundaryFor logic still exists for it) but has no
// caller today; the personal feed slot was replaced by Team activity.
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
  const allItems = data?.items ?? [];
  // req 8: cap the feed at ~10 rows with a "view more" affordance rather than
  // rendering an unbounded scroll; capActivityFeed is the same pure helper
  // both scopes share (see shared/today-defaults.ts).
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount } = capActivityFeed(allItems);
  const items = expanded ? allItems : shown;
  return (
    <section className="flex-1 min-h-0 rounded-xl border border-line bg-panel overflow-hidden flex flex-col">
      <header className={`flex items-center gap-2 ${TODAY_DENSITY.header} border-b border-line-2`}>
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
              className={`w-full text-left flex gap-2 ${TODAY_DENSITY.row} border-b border-line-2 last:border-0 hover:bg-panel-2`}
              onClick={() =>
                job && onOpenJob(job, it.type === "comment" ? "comments" : "overview")
              }
              data-testid={`activity-${it.id}`}
            >
              <span className="w-6 h-6 rounded-full bg-paper-2 text-ink-2 text-[11px] font-semibold grid place-items-center flex-none">
                {it.actor
                  ? `${it.actor.firstName[0] ?? ""}${it.actor.lastName[0] ?? ""}`
                  : "·"}
              </span>
              {/* Two rows only: actor/verb/job + right-justified time on row 1,
                  the note/detail truncated to a single line on row 2. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-ink-2 leading-tight truncate min-w-0 flex-1">
                    {it.actor ? (
                      <strong className="text-ink">{it.actor.firstName}</strong>
                    ) : (
                      <strong className="text-ink">A job</strong>
                    )}{" "}
                    {it.verb} <strong className="text-ink">{it.jobLabel}</strong>
                  </span>
                  <span className="text-[10px] font-mono text-ink-faint leading-tight flex-none whitespace-nowrap">
                    {formatDistanceToNow(new Date(it.at), { addSuffix: true })}
                  </span>
                </div>
                {it.detail && (
                  <div className={`text-[11px] text-ink-mute leading-tight truncate ${TODAY_DENSITY.lineGapTight}`}>{it.detail}</div>
                )}
              </div>
            </button>
          );
        })}
        {!expanded && hiddenCount > 0 && (
          <button
            className="w-full text-center text-xs text-accent hover:underline py-2"
            onClick={() => setExpanded(true)}
            data-testid="activity-view-more"
          >
            View {hiddenCount} more
          </button>
        )}
      </ScrollArea>
    </section>
  );
}
