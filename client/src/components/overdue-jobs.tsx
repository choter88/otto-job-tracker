import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Info,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sortByOrder } from "@/lib/custom-list-sort";
import { buildTrackStatuses, getStepIndex } from "@/lib/lifecycle";
import { formatPatientDisplayName } from "@shared/name-format";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";
import JobDialog from "@/components/job-dialog";
import type { Job, Office, NotificationRule } from "@shared/schema";

interface OverdueJobsProps {
  jobs: any[];
  searchQuery?: string;
}

type Severity = "critical" | "high" | "medium" | "low";

// Each severity has one definition — label, range, icon, color tokens. The
// triage UI all flows from this map so changing a severity color is a
// single-line edit. Tokens use --danger / --warn so the page reads in the
// same vocabulary the rest of the app uses for warnings + destructive
// states (no hardcoded red-50 / orange-50 anywhere).
const SEVERITY_META: Record<Severity, {
  label: string;
  range: string;
  Icon: typeof AlertOctagon;
  rail: string;
  bg: string;
  ring: string;
  iconClass: string;
  daysClass: string;
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
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

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
  const [priorityFilter, setPriorityFilter] = useState<"all" | Severity>("all");
  const [stuckStatusFilter, setStuckStatusFilter] = useState<string>("all");

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

  // Job Details modal mounts in place — clicking a row opens it without
  // navigating away from the Overdue page.
  const [selectedJobForDetails, setSelectedJobForDetails] = useState<Job | null>(null);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [jobDetailsTab, setJobDetailsTab] = useState<JobDetailsTab>("overview");
  const [editingJob, setEditingJob] = useState<Job | undefined>(undefined);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);

  const openJob = (job: Job, panel: JobDetailsTab = "overview") => {
    setSelectedJobForDetails(job);
    setJobDetailsTab(panel);
    setJobDetailsOpen(true);
  };

  const handleStartEditingJob = (job: Job) => {
    setEditingJob(job);
    setJobDialogOpen(true);
  };

  const overdueJobIds = useMemo(
    () => new Set((jobs || []).map((j) => j.id)),
    [jobs],
  );

  // Filter — search + severity + stuck-status filters all combine, then sort
  // by severity (worst first) so the top of the table is the most urgent.
  const filteredJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          searchQuery === "" ||
          job.patientFirstName?.toLowerCase().includes(q) ||
          job.patientLastName?.toLowerCase().includes(q) ||
          job.trayNumber?.toLowerCase().includes(q) ||
          job.phone?.includes(searchQuery.replace(/\D/g, ""));
        const matchesPriority = priorityFilter === "all" || job.severity === priorityFilter;
        const matchesStuck = stuckStatusFilter === "all" || job.status === stuckStatusFilter;
        return matchesSearch && matchesPriority && matchesStuck;
      })
      .sort((a, b) => {
        const sa = SEVERITY_RANK[(a.severity as Severity) || "low"];
        const sb = SEVERITY_RANK[(b.severity as Severity) || "low"];
        if (sa !== sb) return sa - sb;
        return (b.daysOverdue || 0) - (a.daysOverdue || 0);
      });
  }, [jobs, searchQuery, priorityFilter, stuckStatusFilter]);

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

  if (jobs.length === 0) {
    return (
      <div data-testid="overdue-jobs-empty">
        <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mb-4">
          Nothing past its threshold
        </p>
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
      {/* Thin metadata line — topbar already says "Overdue" */}
      <div className="flex items-center gap-2 flex-wrap text-[calc(13px*var(--ui-scale))] text-ink-mute tracking-[-0.005em]">
        <span className="text-danger font-medium">
          {totalOverdue} job{totalOverdue !== 1 ? "s" : ""} past their threshold
        </span>
        {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="text-ink-faint">·</span>
            <span>
              {counts[s]} {SEVERITY_META[s].label.toLowerCase()}
            </span>
          </span>
        ))}
      </div>

      {/* Severity stat strip — clickable filter pills. Empty buckets are
          neutral (no severity color) so a practice with zero "Critical"
          jobs doesn't see a red tile shouting at them. */}
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
                isActive || count > 0 ? meta.rail : "before:bg-line",
                "hover:shadow-soft",
                isActive && cn(meta.bg, "ring-1 ring-inset", meta.ring),
                count === 0 && !isActive && "opacity-60",
              )}
              data-testid={`stat-${severity}`}
              aria-pressed={isActive}
            >
              <div className="flex items-baseline justify-between">
                <span className={cn(
                  "text-[calc(24px*var(--ui-scale))] font-bold tabular-nums",
                  count > 0 ? meta.daysClass : "text-ink-mute",
                )}>
                  {count}
                </span>
                <Icon className={cn(
                  "h-4 w-4",
                  count > 0 ? meta.iconClass : "text-ink-faint",
                )} aria-hidden />
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

      {/* Threshold pills — clickable filter toggles. Click one to scope
          the list to jobs stuck in that status. */}
      {notificationRules.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap text-[calc(11.5px*var(--ui-scale))] text-ink-mute">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 cursor-help shrink-0 pt-1">
                <Info className="h-3.5 w-3.5" aria-hidden />
                Thresholds:
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-xs">
                A job becomes overdue when it sits in a status longer than the
                configured threshold. Click a pill to filter to jobs stuck in
                that status. Manage thresholds in Settings &rarr; Overdue Rules.
              </p>
            </TooltipContent>
          </Tooltip>
          {notificationRules.slice(0, 6).map((rule: any) => {
            const active = stuckStatusFilter === rule.status;
            const stuckCount = jobs.filter((j) => j.status === rule.status).length;
            return (
              <button
                key={rule.id}
                type="button"
                onClick={() => setStuckStatusFilter(active ? "all" : rule.status)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors",
                  active
                    ? "bg-otto-accent-soft border-otto-accent-line text-otto-accent-ink"
                    : stuckCount === 0
                      ? "bg-paper-2 border-line-2 text-ink-mute opacity-60 hover:opacity-100"
                      : "bg-paper-2 border-line-2 hover:border-line-strong hover:text-ink-2",
                )}
                data-testid={`threshold-pill-${rule.status}`}
              >
                <span className="font-medium">
                  {getLabelFromSettings(customStatuses, rule.status)}
                </span>
                <span className="text-ink-faint">·</span>
                <span className="font-mono">{rule.maxDays}d</span>
                {stuckCount > 0 && (
                  <span className={cn(
                    "ml-0.5 text-[calc(10px*var(--ui-scale))] tabular-nums",
                    active ? "text-otto-accent-ink" : "text-ink-mute",
                  )}>
                    ({stuckCount})
                  </span>
                )}
              </button>
            );
          })}
          {stuckStatusFilter !== "all" && (
            <button
              type="button"
              onClick={() => setStuckStatusFilter("all")}
              className="inline-flex items-center gap-1 text-otto-accent-ink hover:text-otto-accent-strong pt-1"
              data-testid="threshold-pill-clear"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {filteredJobs.length === 0 ? (
        <div className="bg-panel border border-line rounded-xl px-6 py-10 text-center text-[calc(13px*var(--ui-scale))] text-ink-mute">
          No jobs match the current filters.
          <Button
            size="sm"
            variant="link"
            className="ml-1.5 h-auto p-0 text-otto-accent-ink"
            onClick={() => {
              setPriorityFilter("all");
              setStuckStatusFilter("all");
            }}
          >
            Clear filters.
          </Button>
        </div>
      ) : (
        /* Table view — five columns, one row per overdue job. Severity
           reads from a colored dot in the leftmost column; everything else
           is calmly typeset so the user's eye lands on the urgency signal
           and the days-over count, not on five competing pill colors. The
           inline Advance button is the most common remediation; clicking
           anywhere else on the row opens the shared Job Details modal. */
        <div className="bg-panel border border-line rounded-xl overflow-hidden">
          <Table className="text-[calc(13px*var(--ui-scale))] [&_th]:h-[34px] [&_th]:px-[14px] [&_th]:text-[calc(10.5px*var(--ui-scale))] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.10em] [&_th]:text-ink-mute [&_td]:px-[14px] [&_td]:py-2 [&_td]:h-[calc(48px*var(--ui-scale))] [&_td]:max-h-[calc(48px*var(--ui-scale))] [&_td]:align-middle [&_td]:overflow-hidden">
            <TableHeader className="[&_tr]:border-b [&_tr]:border-line [&_th]:bg-panel">
              <TableRow>
                <TableHead className="w-[110px] text-left">Severity</TableHead>
                <TableHead className="min-w-[160px] text-left">Patient</TableHead>
                <TableHead className="min-w-[140px] text-left">Stuck in</TableHead>
                <TableHead className="w-[100px] text-right tabular-nums">Days over</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => {
                const severity = (job.severity as Severity) || "low";
                const meta = SEVERITY_META[severity];
                const Icon = meta.Icon;
                const patientName =
                  formatPatientDisplayName(job.patientFirstName, job.patientLastName) ||
                  job.trayNumber ||
                  "Unnamed";
                const statusLabel = getLabelFromSettings(customStatuses, job.status);
                const trackStatuses = buildTrackStatuses(customStatuses);
                const stepIdx = getStepIndex(trackStatuses, job.status);
                const nextStatus =
                  stepIdx >= 0 && stepIdx < trackStatuses.length - 1
                    ? trackStatuses[stepIdx + 1]
                    : null;

                return (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer transition-colors border-b border-line-2 last:border-b-0 bg-panel hover:bg-panel-2"
                    onClick={() => openJob(job as Job, "overview")}
                    data-testid={`row-overdue-${job.id}`}
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.iconClass)} aria-hidden />
                        <span className={cn("font-medium", meta.daysClass)}>
                          {meta.label}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-ink truncate block">
                        {patientName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className="border-0 bg-paper-2 text-ink-2">
                        {statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={cn("font-medium tabular-nums", meta.daysClass)}>
                        {job.daysOverdue}d
                      </span>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {nextStatus ? (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 gap-1 text-[calc(12px*var(--ui-scale))]"
                          onClick={() => handleStatusChange(job.id, nextStatus.id)}
                          disabled={updateJobMutation.isPending}
                          data-testid={`button-advance-${job.id}`}
                        >
                          Advance to {nextStatus.label}
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      ) : (
                        <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute italic">
                          No next status
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Job Details modal mounted in place — clicking a row opens it
          without navigating to the Worklist. */}
      {selectedJobForDetails && (
        <JobDetailsModal
          open={jobDetailsOpen}
          onOpenChange={setJobDetailsOpen}
          job={selectedJobForDetails}
          activeTab={jobDetailsTab}
          onActiveTabChange={setJobDetailsTab}
          onEditJob={handleStartEditingJob}
          overdueJobIds={overdueJobIds}
        />
      )}

      <JobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        job={editingJob}
      />
    </div>
  );
}
