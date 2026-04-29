import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Hourglass,
  Info,
  MessageSquare,
  Minus,
  MoreVertical,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import LifecycleTrack from "@/components/lifecycle-track";
import PageHead, { SubDanger, SubDot } from "@/components/page-head";
import {
  getStatusBadgeStyle,
  getTypeBadgeStyle,
  getDestinationBadgeStyle,
} from "@/lib/default-colors";
import { buildTrackStatuses, getStepIndex } from "@/lib/lifecycle";
import { sortByOrder } from "@/lib/custom-list-sort";
import { formatPatientDisplayName } from "@shared/name-format";
import type { Office, NotificationRule } from "@shared/schema";

interface OverdueJobsProps {
  jobs: any[];
  searchQuery?: string;
}

type Severity = "critical" | "high" | "medium" | "low";

// Design tokens — kept in one place so each severity is described by a single
// vocabulary (label, range, icon, color tokens). The styling all flows from
// here so changing a severity rail color is a single-line edit.
const SEVERITY_META: Record<Severity, {
  label: string;
  range: string;
  Icon: typeof AlertOctagon;
  // Tailwind classes built from the design tokens (--danger / --warn). No
  // hardcoded red-50 / orange-50 — all severity colors come from the same
  // palette the rest of Otto uses for warnings + destructive actions.
  rail: string;        // left rail color on cards
  bg: string;          // soft tint for severity stat tile
  ring: string;        // active ring on selected stat
  iconClass: string;   // icon color
  daysClass: string;   // "X days over" text color
}> = {
  critical: {
    label: "Critical",
    range: "7+ days over",
    Icon: AlertOctagon,
    rail: "before:bg-danger",
    bg: "bg-danger-bg/40",
    ring: "ring-danger/30",
    iconClass: "text-danger",
    daysClass: "text-danger",
  },
  high: {
    label: "High",
    range: "3–7 days over",
    Icon: AlertTriangle,
    rail: "before:bg-warn",
    bg: "bg-warn-bg/40",
    ring: "ring-warn/30",
    iconClass: "text-warn",
    daysClass: "text-warn",
  },
  medium: {
    label: "Medium",
    range: "1–3 days over",
    Icon: Clock,
    rail: "before:bg-warn/50",
    bg: "bg-warn-bg/20",
    ring: "ring-warn/15",
    iconClass: "text-warn/80",
    daysClass: "text-ink-2",
  },
  low: {
    label: "Low",
    range: "< 1 day over",
    Icon: Minus,
    rail: "before:bg-line-strong",
    bg: "bg-paper-2",
    ring: "ring-line",
    iconClass: "text-ink-mute",
    daysClass: "text-ink-mute",
  },
};

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

function getLabelFromSettings(list: any[], value: string): string {
  if (!value) return "";
  if (!Array.isArray(list) || list.length === 0) return value;
  const byId = list.find((item) => item?.id === value);
  if (byId?.label) return String(byId.label);
  const byLabel = list.find((item) => item?.label === value);
  if (byLabel?.label) return String(byLabel.label);
  return value;
}

export default function OverdueJobs({ jobs, searchQuery = "" }: OverdueJobsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [priorityFilter, setPriorityFilter] = useState<"all" | Severity>("all");
  const [noteDialogJobId, setNoteDialogJobId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: notificationRules = [] } = useQuery<NotificationRule[]>({
    queryKey: ["/api/notification-rules"],
    enabled: !!user?.officeId,
  });

  const customStatuses = useMemo(
    () => sortByOrder(((office?.settings as any)?.customStatuses || []) as any[]),
    [office],
  );
  const customJobTypes = useMemo(
    () => ((office?.settings as any)?.customJobTypes || []) as any[],
    [office],
  );
  const customOrderDestinations = useMemo(
    () => ((office?.settings as any)?.customOrderDestinations || []) as any[],
    [office],
  );
  const jobIdentifierMode = (office?.settings as any)?.jobIdentifierMode || "patientName";
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  const updateJobMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/jobs/${id}`, updates);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
      const newStatus = (variables as any)?.updates?.status as string | undefined;
      const label = newStatus
        ? customStatuses.find((s: any) => s.id === newStatus)?.label || newStatus
        : "";
      toast({ title: "Status updated", description: label ? `Set to ${label}.` : undefined });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ jobId, content }: { jobId: string; content: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/comments`, {
        content,
        isOverdueComment: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Note added", description: "Saved to the job's comments thread." });
      setNoteDialogJobId(null);
      setNoteContent("");
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't add note", description: error.message, variant: "destructive" });
    },
  });

  // Filter
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === "" ||
        job.patientFirstName?.toLowerCase().includes(q) ||
        job.patientLastName?.toLowerCase().includes(q) ||
        job.trayNumber?.toLowerCase().includes(q) ||
        job.phone?.includes(searchQuery.replace(/\D/g, ""));
      const matchesPriority = priorityFilter === "all" || job.severity === priorityFilter;
      return matchesSearch && matchesPriority;
    });
  }, [jobs, searchQuery, priorityFilter]);

  // Counts by severity (always from full jobs list, not filtered)
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const job of jobs) {
      if (job.severity in c) c[job.severity as Severity]++;
    }
    return c;
  }, [jobs]);

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobMutation.mutate({ id: jobId, updates: { status: newStatus } });
  };

  const handleSubmitNote = () => {
    if (noteContent.trim() && noteDialogJobId) {
      addNoteMutation.mutate({ jobId: noteDialogJobId, content: noteContent.trim() });
    }
  };

  const handleOpenDetails = (jobId: string) => {
    setLocation("/");
    window.setTimeout(() => {
      try {
        window.dispatchEvent(
          new CustomEvent("otto:openJob", { detail: { jobId, panel: "overview" } }),
        );
      } catch {
        /* ignore */
      }
    }, 150);
  };

  // Empty state — celebratory, not bland. Emerald check inside an emerald
  // ring lets the "everything's fine" state read as a small win instead of
  // an empty list.
  if (jobs.length === 0) {
    return (
      <div data-testid="overdue-jobs-empty">
        <PageHead
          title="Overdue"
          className="mb-4"
          sub={<span>Nothing past its threshold</span>}
        />
        <div className="bg-panel border border-line rounded-xl px-6 py-12 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-full bg-otto-accent-soft grid place-items-center mb-4 ring-1 ring-otto-accent-line">
            <CheckCircle2 className="h-7 w-7 text-otto-accent-ink" aria-hidden />
          </span>
          <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
            All caught up
          </h3>
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1.5 max-w-md">
            Every job is within its expected timeframe. Otto will flag jobs here
            automatically when they sit in a status longer than the rules allow.
          </p>
        </div>
      </div>
    );
  }

  const totalOverdue = jobs.length;

  return (
    <div className="space-y-4" data-testid="overdue-jobs">
      <PageHead
        title="Overdue"
        className="mb-2"
        sub={
          <>
            <SubDanger>
              {totalOverdue} job{totalOverdue !== 1 ? "s" : ""} past their threshold
            </SubDanger>
            {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <SubDot />
                <span>
                  {counts[s]} {SEVERITY_META[s].label.toLowerCase()}
                </span>
              </span>
            ))}
          </>
        }
      />

      {/* Severity stat strip — clickable filter pills sized to the same
          design tokens as the rest of the app. Each tile has a left rail
          in the severity color so it reads as triage at a glance. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {SEVERITIES.map((severity) => {
          const meta = SEVERITY_META[severity];
          const count = counts[severity];
          const isActive = priorityFilter === severity;
          const Icon = meta.Icon;

          return (
            <button
              key={severity}
              type="button"
              onClick={() =>
                setPriorityFilter(priorityFilter === severity ? "all" : severity)
              }
              className={cn(
                "relative overflow-hidden text-left rounded-xl border border-line bg-panel pl-4 pr-3 py-3 transition-all",
                "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
                meta.rail,
                "hover:shadow-soft",
                isActive && cn(meta.bg, "ring-1 ring-inset", meta.ring),
                count === 0 && "opacity-60",
              )}
              data-testid={`stat-${severity}`}
              aria-pressed={isActive}
            >
              <div className="flex items-baseline justify-between">
                <span className={cn("text-[calc(24px*var(--ui-scale))] font-bold tabular-nums", meta.daysClass)}>
                  {count}
                </span>
                <Icon className={cn("h-4 w-4", meta.iconClass)} aria-hidden />
              </div>
              <div className="text-[calc(13px*var(--ui-scale))] font-medium text-ink mt-1">
                {meta.label}
              </div>
              <div className="text-[calc(11px*var(--ui-scale))] text-ink-mute">
                {meta.range}
              </div>
            </button>
          );
        })}
      </div>

      {/* Rules summary line — quiet so it sits below the stat strip but is
          still discoverable. */}
      {notificationRules.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap text-[calc(11.5px*var(--ui-scale))] text-ink-mute">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 cursor-help shrink-0">
                <Info className="h-3.5 w-3.5" aria-hidden />
                Thresholds:
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-xs">
                A job becomes overdue when it sits in a status longer than the
                configured threshold. Manage these in Settings &rarr; Overdue Rules.
              </p>
            </TooltipContent>
          </Tooltip>
          {notificationRules.slice(0, 6).map((rule: any) => (
            <span
              key={rule.id}
              className="inline-flex items-center gap-1 rounded-full bg-paper-2 border border-line-2 px-2 py-0.5"
            >
              <span className="font-medium text-ink-2">
                {getLabelFromSettings(customStatuses, rule.status)}
              </span>
              <span className="text-ink-faint">·</span>
              <span className="font-mono">{rule.maxDays}d</span>
            </span>
          ))}
        </div>
      )}

      {filteredJobs.length === 0 ? (
        <div className="bg-panel border border-line rounded-xl px-6 py-10 text-center text-[calc(13px*var(--ui-scale))] text-ink-mute">
          No jobs match the {priorityFilter} filter.
          <Button
            size="sm"
            variant="link"
            className="ml-1.5 h-auto p-0 text-otto-accent-ink"
            onClick={() => setPriorityFilter("all")}
          >
            Show all severities.
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredJobs.map((job) => {
            const severity = (job.severity as Severity) || "low";
            const meta = SEVERITY_META[severity];
            const Icon = meta.Icon;
            const patientName = useTrayNumber
              ? job.trayNumber || "Tray not set"
              : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed";
            const statusLabel = getLabelFromSettings(customStatuses, job.status);
            const jobTypeLabel = getLabelFromSettings(customJobTypes, job.jobType);
            const destinationLabel = getLabelFromSettings(customOrderDestinations, job.orderDestination);
            const statusBadge = getStatusBadgeStyle(job.status, customStatuses as any);
            const jobTypeBadge = getTypeBadgeStyle(job.jobType, customJobTypes as any);
            const destinationBadge = getDestinationBadgeStyle(job.orderDestination, customOrderDestinations as any);

            const trackStatuses = buildTrackStatuses(customStatuses);
            const stepIdx = getStepIndex(trackStatuses, job.status);
            const nextStatus =
              stepIdx >= 0 && stepIdx < trackStatuses.length - 1 ? trackStatuses[stepIdx + 1] : null;
            const ruleMaxDays = job.rule?.maxDays;
            const stuckFor = (job.daysOverdue ?? 0) + (typeof ruleMaxDays === "number" ? ruleMaxDays : 0);

            const initials =
              (patientName || "?")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((s: string) => s[0] || "")
                .join("")
                .toUpperCase() || "?";

            return (
              <div
                key={job.id}
                className={cn(
                  "relative overflow-hidden bg-panel border border-line rounded-xl px-4 py-3",
                  "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
                  meta.rail,
                  "hover:shadow-soft transition-shadow",
                )}
                data-testid={`overdue-job-${job.id}`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar tinted with the current status color so identity
                      carries through to the worklist + Job Details. */}
                  <span
                    className="w-9 h-9 rounded-full grid place-items-center text-[calc(11px*var(--ui-scale))] font-semibold tracking-wider shrink-0 ring-1 ring-inset ring-line"
                    style={{ backgroundColor: statusBadge.background, color: statusBadge.text }}
                    aria-hidden
                  >
                    {initials}
                  </span>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* Top row — name + badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        className="font-display text-[calc(15px*var(--ui-scale))] font-medium tracking-[-0.01em] text-ink m-0 leading-tight"
                        data-testid={`text-patient-${job.id}`}
                      >
                        {patientName}
                      </h3>
                      <Badge
                        className="border-0"
                        style={{ backgroundColor: jobTypeBadge.background, color: jobTypeBadge.text }}
                      >
                        <span className="max-w-[140px] truncate">{jobTypeLabel}</span>
                      </Badge>
                      <Badge
                        className="border-0"
                        style={{ backgroundColor: statusBadge.background, color: statusBadge.text }}
                      >
                        <span className="max-w-[140px] truncate">{statusLabel}</span>
                      </Badge>
                      <Badge className="border-0 bg-paper-2 text-ink-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full mr-1.5"
                          style={{ backgroundColor: destinationBadge.text }}
                          aria-hidden
                        />
                        {destinationLabel}
                      </Badge>
                    </div>

                    {/* Severity line — leads with the icon + the human-readable
                        "stuck for X days" rather than an opaque "Days Overdue"
                        column. */}
                    <div className="flex items-center gap-1.5 text-[calc(12.5px*var(--ui-scale))]">
                      <Icon className={cn("h-3.5 w-3.5", meta.iconClass)} aria-hidden />
                      <span className={cn("font-medium", meta.daysClass)}>
                        {job.daysOverdue} day{job.daysOverdue === 1 ? "" : "s"} over
                      </span>
                      {typeof ruleMaxDays === "number" && (
                        <span className="text-ink-mute">
                          <span className="text-ink-faint mx-1">·</span>
                          stuck in {statusLabel} for {stuckFor} day{stuckFor === 1 ? "" : "s"}
                          <span className="text-ink-faint mx-1">·</span>
                          rule: max {ruleMaxDays}d
                        </span>
                      )}
                    </div>

                    {/* Lifecycle bar — visual answer to "where is this job?".
                        Compact size matches the worklist row treatment. */}
                    {customStatuses.length > 0 && (
                      <div className="pt-0.5">
                        <LifecycleTrack
                          statuses={customStatuses as any}
                          currentStatusId={job.status}
                          interactive={false}
                          hideLabel
                          size="compact"
                        />
                      </div>
                    )}
                  </div>

                  {/* Action stack on the right */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {nextStatus && (
                      <Button
                        size="sm"
                        onClick={() => handleStatusChange(job.id, nextStatus.id)}
                        disabled={updateJobMutation.isPending}
                        data-testid={`button-advance-${job.id}`}
                      >
                        Advance to {nextStatus.label}
                        <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          data-testid={`button-menu-${job.id}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onSelect={() => {
                            setNoteDialogJobId(job.id);
                            setNoteContent("");
                          }}
                          data-testid={`menu-add-note-${job.id}`}
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Add note to thread
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => handleOpenDetails(job.id)}
                          data-testid={`menu-open-${job.id}`}
                        >
                          <ArrowRight className="h-4 w-4 mr-2" />
                          Open job details
                        </DropdownMenuItem>
                        {customStatuses.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[calc(10.5px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                              Set status
                            </DropdownMenuLabel>
                            {customStatuses.map((status: any) => (
                              <DropdownMenuItem
                                key={status.id}
                                disabled={status.id === job.status}
                                onSelect={() => handleStatusChange(job.id, status.id)}
                                data-testid={`menu-status-${status.id}-${job.id}`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full mr-2.5"
                                  style={{ backgroundColor: getStatusBadgeStyle(status.id, customStatuses as any).text }}
                                  aria-hidden
                                />
                                {status.label}
                                {status.id === job.status && (
                                  <span className="ml-auto text-[calc(10px*var(--ui-scale))] text-ink-mute">
                                    current
                                  </span>
                                )}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Latest activity timestamp footer — small, monospaced so it
                    reads as data, not chrome. */}
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-line-2 text-[calc(10.5px*var(--ui-scale))] text-ink-mute">
                  <Hourglass className="h-3 w-3" aria-hidden />
                  <span className="font-mono">
                    Status set {format(new Date(job.statusChangedAt || job.createdAt), "MMM d · HH:mm")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Note dialog — sticky-note styling matches the Job Details
          modal Notes block + Important page note dialog. */}
      <Dialog open={!!noteDialogJobId} onOpenChange={(open) => !open && setNoteDialogJobId(null)}>
        <DialogContent className="w-full max-w-xl">
          <DialogHeader>
            <DialogTitle asChild>
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-warn" />
                <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
                  Add overdue note
                </h3>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute">
              Note goes into the job&rsquo;s comments thread so the rest of your
              team sees the context.
            </p>
            <Textarea
              placeholder="What's the holdup? e.g. waiting on lab confirmation, patient hasn't picked up the phone…"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={5}
              className="resize-none bg-warn-bg/30 border-warn/20 focus-visible:ring-warn/40"
              data-testid="textarea-overdue-note"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNoteDialogJobId(null)}
              data-testid="button-cancel-note"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitNote}
              disabled={!noteContent.trim() || addNoteMutation.isPending}
              data-testid="button-submit-note"
            >
              {addNoteMutation.isPending ? "Adding…" : "Add note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
