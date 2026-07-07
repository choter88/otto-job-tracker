import { useEffect, useState } from "react";
import { HelpCircle, Plus } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import NotificationBell from "@/components/notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import JobDialog from "@/components/job-dialog";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";
import SearchPalette from "@/components/search-palette";
import { useToast } from "@/hooks/use-toast";
import { TODAY_EVENTS } from "@shared/today-telemetry";
import type { Job } from "@shared/schema";

interface TopbarProps {
  /** Current active tab id — used to derive the crumb label. */
  activeTab: string;
  onHelpClick?: () => void;
}

const TAB_LABELS: Record<string, string> = {
  today: "Today",
  all: "Worklist",
  // Route id stays "important" for URL stability; only the label flipped
  // when we renamed the action to "starring" across the app.
  important: "Starred",
  overdue: "Overdue",
  past: "Past Jobs",
  orderSheets: "Order Sheets",
  analytics: "Analytics",
  team: "Team",
  settings: "Settings",
};

// Thin wrapper around POST /api/track for Today Dashboard v2 client events.
// Fire-and-forget — telemetry failures must never break the UI. Metadata is
// numbers/enums only (see ClientTodayMetadata) so PHI can never be logged.
function trackTodayEvent(eventType: (typeof TODAY_EVENTS)[keyof typeof TODAY_EVENTS], metadata?: Record<string, number>) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType, metadata: metadata ?? {} }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

function HeaderClock() {
  // Live wall clock for the header. Self-contained so only this node re-renders
  // on tick. ponytail: 1s interval, trivial cost; minute granularity is all we show.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right leading-tight" data-testid="header-clock">
      <div className="text-[calc(12.5px*var(--ui-scale))] font-medium text-ink">
        {format(now, "EEEE, MMM d")}
      </div>
      <div className="font-mono text-[calc(11px*var(--ui-scale))] text-ink-mute tabular-nums">
        {format(now, "h:mm a")}
      </div>
    </div>
  );
}

export default function Topbar({ activeTab, onHelpClick }: TopbarProps) {
  const label = TAB_LABELS[activeTab] || "Otto";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Job record view, opened from a search-palette selection. Mirrors
  // today.tsx's JobDetailsModal usage (open/job/activeTab state).
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<JobDetailsTab>("overview");

  // Global (meta||ctrl)+K opens the search palette from any authenticated
  // screen — Topbar is mounted on every tab via dashboard.tsx, so a single
  // listener here covers the whole app.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Emit today_search_opened once per open, not per keystroke.
  useEffect(() => {
    if (searchOpen) trackTodayEvent(TODAY_EVENTS.SEARCH_OPENED);
  }, [searchOpen]);

  const handleSelectJob = (jobId: string) => {
    const jobs = queryClient.getQueryData<Job[]>(["/api/jobs"]) ?? [];
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      toast({ title: "Job not found in active list" });
      return;
    }
    setSelectedJob(job);
    setDetailsTab("overview");
    setDetailsOpen(true);
  };

  return (
    <header
      className="bg-panel border-b border-line px-5 h-[52px] flex items-center gap-3 shrink-0"
      data-testid="topbar"
    >
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <span className="font-display text-[calc(15px*var(--ui-scale))] font-semibold text-ink truncate" data-testid="text-topbar-crumb">
          {label}
        </span>
      </div>

      <span className="flex-1" />

      <Button
        size="sm"
        onClick={() => {
          trackTodayEvent(TODAY_EVENTS.NEW_JOB_CLICKED);
          setJobDialogOpen(true);
        }}
        data-testid="button-topbar-new-job"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        New Job
      </Button>

      <HeaderClock />

      <NotificationBell />

      {onHelpClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onHelpClick}
              className="w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:bg-line-2 hover:text-ink"
              aria-label="Help &amp; feedback"
              data-testid="button-topbar-help"
            >
              <HelpCircle className="h-[15px] w-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Help &amp; feedback</TooltipContent>
        </Tooltip>
      )}

      <JobDialog open={jobDialogOpen} onOpenChange={setJobDialogOpen} job={undefined} />

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelectJob={handleSelectJob} />

      {selectedJob && (
        <JobDetailsModal
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          job={selectedJob}
          activeTab={detailsTab}
          onActiveTabChange={setDetailsTab}
          onEditJob={() => { /* Search result view is read-first, same as Today */ }}
        />
      )}
    </header>
  );
}
