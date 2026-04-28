import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Hash,
  Info,
  Link2,
  MessageSquare,
  Phone,
  Send,
  Star,
  StickyNote,
  Trash2,
  Unlink,
  User,
  X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import JobCommentsPanel from "@/components/job-comments-panel";
import { getStatusBadgeStyle, getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { sortByOrder } from "@/lib/custom-list-sort";
import { buildTrackStatuses, getStepIndex } from "@/lib/lifecycle";
import { formatPatientDisplayName } from "@shared/name-format";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

export type JobDetailsTab = "overview" | "comments" | "related";

interface JobStatusHistoryEntry {
  id: string;
  jobId: string;
  oldStatus: string | null;
  newStatus: string;
  changedAt: string | number | Date;
  changedBy: string | null;
  changedByUser: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

interface JobDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: Job;
  activeTab: JobDetailsTab;
  onActiveTabChange: (tab: JobDetailsTab) => void;
  onEditJob: (job: Job) => void;
  onSwitchJob?: (jobId: string) => void;
  flaggedJobIds?: string[];
  overdueJobIds?: Set<string>;
}

function toTitleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export default function JobDetailsModal({
  open,
  onOpenChange,
  job,
  activeTab,
  onActiveTabChange,
  onEditJob,
  onSwitchJob,
  flaggedJobIds = [],
  overdueJobIds = new Set(),
}: JobDetailsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId && open,
  });

  const { data: statusHistory = [], isLoading: historyLoading } = useQuery<JobStatusHistoryEntry[]>({
    queryKey: ["/api/jobs", job?.id, "status-history"],
    queryFn: async () => {
      if (!job?.id) return [];
      const res = await fetch(`/api/jobs/${job.id}/status-history`, { credentials: "include" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || res.statusText || "Failed to load status history");
      }
      return res.json();
    },
    enabled: !!job?.id && open,
  });

  const { data: relatedData } = useQuery<{ jobs: any[]; groupId: string | null }>({
    queryKey: ["/api/jobs", job?.id, "related"],
    queryFn: async () => {
      if (!job?.id) return { jobs: [], groupId: null };
      const res = await fetch(`/api/jobs/${job.id}/related`, { credentials: "include" });
      if (!res.ok) return { jobs: [], groupId: null };
      const data = await res.json();
      // Handle both old format (array) and new format ({ jobs, groupId })
      if (Array.isArray(data)) return { jobs: data, groupId: null };
      return data;
    },
    enabled: !!job?.id && open,
  });
  const relatedJobs = relatedData?.jobs ?? [];
  const linkGroupId = relatedData?.groupId ?? null;

  // Group notes for linked jobs
  const { data: groupNotes = [] } = useQuery<any[]>({
    queryKey: ["/api/link-groups", linkGroupId, "notes"],
    queryFn: async () => {
      if (!linkGroupId) return [];
      const res = await fetch(`/api/link-groups/${linkGroupId}/notes`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!linkGroupId && open,
  });

  const [newGroupNote, setNewGroupNote] = useState("");

  const addGroupNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!linkGroupId) throw new Error("No link group");
      const res = await apiRequest("POST", `/api/link-groups/${linkGroupId}/notes`, { content });
      return res.json();
    },
    onSuccess: () => {
      setNewGroupNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups", linkGroupId, "notes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add note", description: error.message, variant: "destructive" });
    },
  });

  const deleteGroupNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest("DELETE", `/api/link-groups/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups", linkGroupId, "notes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete note", description: error.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}/link`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "related"] });
      toast({ title: "Job unlinked" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unlink job", description: error.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (!job?.id) return;
      // Server endpoint is PUT /api/jobs/:id (not PATCH). Earlier code used
      // PATCH which silently 405'd, making the Advance / Mark CTA buttons
      // appear inert.
      await apiRequest("PUT", `/api/jobs/${job.id}`, { status: newStatus });
    },
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "status-history"] });
      const label = customStatuses.find((s: any) => s.id === newStatus)?.label || newStatus;
      toast({ title: "Status updated", description: `Set to ${label}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const customStatuses = useMemo(() => sortByOrder((office?.settings?.customStatuses || []) as any[]), [office?.settings?.customStatuses]);
  const customJobTypes = useMemo(() => sortByOrder((office?.settings?.customJobTypes || []) as any[]), [office?.settings?.customJobTypes]);
  const customOrderDestinations = useMemo(
    () => sortByOrder((office?.settings?.customOrderDestinations || []) as any[]),
    [office?.settings?.customOrderDestinations],
  );
  const customColumns = useMemo(
    () => sortByOrder((office?.settings?.customColumns || []) as any[]).filter((col: any) => col.active),
    [office?.settings?.customColumns],
  );
  const jobIdentifierMode = useMemo(() => (office?.settings?.jobIdentifierMode || "patientName") as string, [office?.settings?.jobIdentifierMode]);
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  const getStatusLabel = (status: string) =>
    customStatuses.find((entry) => entry.id === status)?.label || toTitleCase(status);
  const getJobTypeLabel = (jobType: string) =>
    customJobTypes.find((entry) => entry.id === jobType)?.label || toTitleCase(jobType);
  const getDestinationLabel = (destination: string) =>
    customOrderDestinations.find((entry) => entry.id === destination || entry.label === destination)?.label ||
    toTitleCase(destination);

  const getStatusBadgeColor = (status: string) =>
    getStatusBadgeStyle(status, customStatuses);

  const getJobTypeBadgeColor = (jobType: string) =>
    getTypeBadgeStyle(jobType, customJobTypes);

  // Used by the Related tab's per-row destination badge.
  const getDestinationBadgeColor = (destination: string) =>
    getDestinationBadgeStyle(destination, customOrderDestinations);

  if (!job) return null;

  const patientDisplayName = useTrayNumber
    ? job.trayNumber || "Tray not set"
    : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed patient";

  const statusBadgeColor = getStatusBadgeColor(job.status);

  // Compute the next forward status for the "Mark <next>" footer button.
  const trackStatuses = buildTrackStatuses(customStatuses);
  const currentStepIdx = getStepIndex(trackStatuses, job.status);
  const nextStatus = currentStepIdx >= 0 && currentStepIdx < trackStatuses.length - 1
    ? trackStatuses[currentStepIdx + 1]
    : null;
  const previousStatus = currentStepIdx > 0 ? trackStatuses[currentStepIdx - 1] : null;

  // Job comments — used for activity timeline + tab badge counts.
  const lastUpdatedRelative = (() => {
    try {
      return formatDistanceToNow(new Date(job.updatedAt), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height keeps the footer + tabs anchored regardless of which
          tab is showing — tab bodies scroll internally. hideClose suppresses
          Radix's default top-right X (we render our own inside the custom
          header). */}
      <DialogContent
        hideClose
        className="max-w-[1013px] w-[min(1013px,calc(100vw-48px))] h-[min(720px,calc(100vh-64px))] p-0 overflow-hidden flex flex-col gap-0"
        data-testid="dialog-job-details"
      >
        {/* Header — patient/tray identifier, status pill, close X */}
        <div className="flex items-center gap-3 px-6 py-[18px] border-b border-line">
          <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0 truncate">
            {patientDisplayName}
          </h3>
          <Badge
            className="border-0 shrink-0"
            style={{ backgroundColor: statusBadgeColor.background, color: statusBadgeColor.text }}
            data-testid="badge-job-status"
          >
            {getStatusLabel(job.status)}
          </Badge>
          {job.isRedoJob && (
            <Badge className="border-0 shrink-0 bg-danger-bg text-danger" data-testid="badge-redo">
              REDO
            </Badge>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-md grid place-items-center text-ink-mute hover:bg-line-2 hover:text-ink shrink-0"
            aria-label="Close"
            data-testid="button-close-job-details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            onActiveTabChange(value as JobDetailsTab);
            const tabEvent = value === "comments"
              ? "job_detail_tab_comments"
              : value === "related"
                ? "job_detail_tab_related"
                : "job_detail_tab_overview";
            fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ eventType: tabEvent }) }).catch(() => {});
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Underline-style tabs (mockup). Trigger row is fixed-height so
              switching tabs doesn't reflow the modal even when the Related
              trigger appears asynchronously. */}
          <TabsList className="flex h-[40px] shrink-0 bg-transparent p-0 px-4 border-b border-line rounded-none justify-start gap-0">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
              data-testid="tab-job-details-overview"
            >
              <Info className="h-[14px] w-[14px]" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="comments"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
              data-testid="tab-job-details-comments"
            >
              <MessageSquare className="h-[14px] w-[14px]" />
              Comments
            </TabsTrigger>
            {relatedJobs.length > 0 && (
              <TabsTrigger
                value="related"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
                data-testid="tab-job-details-related"
              >
                <Link2 className="h-[14px] w-[14px]" />
                Related <span className="text-[calc(11px*var(--ui-scale))] font-mono text-ink-faint">{relatedJobs.length + 1}</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent
            forceMount
            value="overview"
            className="mt-0 flex-1 min-h-0 overflow-y-auto px-6 py-5 data-[state=inactive]:hidden"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-7">
              {/* Left column: Patient & Order, Custom fields, Notes */}
              <div>
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <User className="h-3 w-3" aria-hidden />
                  Patient &amp; Order
                </h4>
                <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[calc(13px*var(--ui-scale))]">
                  <dt className="text-ink-mute pt-0.5">{useTrayNumber ? "Tray" : "Patient"}</dt>
                  <dd className="m-0 flex items-center gap-2">
                    {/* Avatar tinted with the current status color so the
                        identity in the header pill carries through to the
                        body — gives the modal a cohesive accent rather than
                        a bland gray circle. */}
                    <span
                      className="w-7 h-7 rounded-full grid place-items-center text-[calc(10.5px*var(--ui-scale))] font-semibold tracking-wider shrink-0 ring-1 ring-inset ring-line"
                      style={{ backgroundColor: statusBadgeColor.background, color: statusBadgeColor.text }}
                      aria-hidden
                    >
                      {(patientDisplayName || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase() || "?"}
                    </span>
                    <span className="font-medium">{patientDisplayName}</span>
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Phone</dt>
                  <dd className="m-0 flex items-center gap-1.5">
                    <span className="font-mono text-[calc(12.5px*var(--ui-scale))]">{job.phone || "—"}</span>
                    {job.phone && (
                      <button
                        type="button"
                        onClick={() => { window.location.href = `tel:${job.phone}`; }}
                        className="w-6 h-6 rounded grid place-items-center text-otto-accent-ink hover:bg-otto-accent-soft hover:text-otto-accent-strong transition-colors"
                        aria-label="Call"
                        title="Call"
                        data-testid="button-call-patient"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Job type</dt>
                  <dd className="m-0">
                    {(() => {
                      const c = getJobTypeBadgeColor(job.jobType);
                      return (
                        <Badge
                          className="border-0"
                          style={{ backgroundColor: c.background, color: c.text }}
                        >
                          {getJobTypeLabel(job.jobType)}
                        </Badge>
                      );
                    })()}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Sent to</dt>
                  <dd className="m-0">
                    <Badge className="border-0 bg-paper-2 text-ink-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-ink-3 mr-1.5" />
                      {getDestinationLabel(job.orderDestination)}
                    </Badge>
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Created</dt>
                  <dd className="m-0 font-mono text-[calc(12.5px*var(--ui-scale))]">
                    {format(new Date(job.createdAt), "MMM d · HH:mm")}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Updated</dt>
                  <dd className="m-0 font-mono text-[calc(12.5px*var(--ui-scale))]">
                    {lastUpdatedRelative}
                  </dd>
                </dl>

                {customColumns.length > 0 && (
                  <>
                    <div className="border-t border-line my-5" />
                    <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                      <Hash className="h-3 w-3" aria-hidden />
                      Custom fields
                    </h4>
                    <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[calc(13px*var(--ui-scale))]">
                      {customColumns.map((column: any) => {
                        const value = (job.customColumnValues as Record<string, any>)?.[column.id];
                        const displayValue =
                          column.type === "checkbox" ? (value ? "Yes" : "No") : value || "—";
                        return (
                          <div key={column.id} className="contents">
                            <dt className="text-ink-mute pt-0.5">{column.name}</dt>
                            <dd className="m-0 font-medium">{displayValue}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </>
                )}

                <div className="border-t border-line my-5" />
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <StickyNote className="h-3 w-3" aria-hidden />
                  Notes
                </h4>
                {/* Warm notepaper tint + amber left-rail evokes a real
                    sticky note without leaving the design language —
                    --warn-bg is the same amber Otto already uses for
                    overdue / warning surfaces, just dialed back. */}
                <div className="rounded-lg bg-warn-bg/40 border border-warn/15 border-l-[3px] border-l-warn/60 px-3.5 py-2.5 text-[calc(13px*var(--ui-scale))] leading-relaxed text-ink-2 min-h-[60px]">
                  {job.notes?.trim() ? (
                    <p className="whitespace-pre-wrap m-0">{job.notes}</p>
                  ) : (
                    <p className="text-ink-mute italic m-0">No notes added.</p>
                  )}
                </div>
              </div>

              {/* Right column: Timeline (lifecycle history with actor + timestamp). */}
              <div>
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <Clock3 className="h-3 w-3" aria-hidden />
                  Timeline
                </h4>
                <div className="relative pl-[18px]">
                  {/* Vertical line behind timeline dots */}
                  <span className="absolute left-[5px] top-2 bottom-2 w-[1.5px] bg-line" aria-hidden />
                  {trackStatuses.map((s) => {
                    const stepIdx = trackStatuses.findIndex((t) => t.id === s.id);
                    const isPast = stepIdx < currentStepIdx;
                    const isCurrent = stepIdx === currentStepIdx;
                    const entry = statusHistory.find((e) => e.newStatus === s.id);
                    const actorName = entry
                      ? (entry.changedByUser?.firstName || entry.changedByUser?.lastName
                          ? `${entry.changedByUser?.firstName || ""} ${entry.changedByUser?.lastName || ""}`.trim()
                          : "System")
                      : null;
                    // Past dots inherit each step's own status color so the
                    // timeline reads as a journey through the office's
                    // status palette instead of a uniform gray run. Current
                    // step keeps the otto-accent glow as the focal point;
                    // pending stays empty/outlined.
                    const stepColor = isPast ? getStatusBadgeColor(s.id) : null;
                    return (
                      <div key={s.id} className="relative py-1.5">
                        <span
                          className={cn(
                            "absolute -left-[17px] top-2 w-[9px] h-[9px] rounded-full",
                            isCurrent && "bg-otto-accent ring-[1.5px] ring-otto-accent shadow-[0_0_0_4px_var(--otto-accent-soft)]",
                            !isPast && !isCurrent && "bg-panel ring-[1.5px] ring-line-strong",
                          )}
                          style={
                            stepColor
                              ? { backgroundColor: stepColor.text, boxShadow: `0 0 0 1.5px ${stepColor.text}` }
                              : undefined
                          }
                          aria-hidden
                        />
                        <div className={cn(
                          "text-[calc(13px*var(--ui-scale))] leading-tight",
                          isCurrent ? "font-semibold text-ink" : "font-medium text-ink",
                          !isPast && !isCurrent && "text-ink-2",
                        )}>
                          {s.label}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {entry ? (
                            <>
                              <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute">{actorName}</span>
                              <span className="font-mono text-[calc(11px*var(--ui-scale))] text-ink-mute">
                                {format(new Date(entry.changedAt), "MMM d · HH:mm")}
                              </span>
                            </>
                          ) : isCurrent ? (
                            <span className="text-[calc(11.5px*var(--ui-scale))] text-otto-accent-ink italic">in progress · now</span>
                          ) : (
                            <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-faint italic">pending</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* No bottom "Loading…" sentinel — the timeline renders
                      its skeleton state from trackStatuses synchronously and
                      fills in actor/timestamps as statusHistory arrives, so
                      we avoid a height shift when the async query resolves. */}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            forceMount
            value="comments"
            className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="h-full overflow-hidden bg-panel">
              <JobCommentsPanel job={job} />
            </div>
          </TabsContent>

          {/* Related Jobs tab — auto-detected by patient name match + manually linked */}
          {relatedJobs.length > 0 && (
            <TabsContent
              forceMount
              value="related"
              className="mt-0 flex-1 min-h-0 overflow-y-auto px-6 py-5 data-[state=inactive]:hidden"
            >
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Related jobs for this patient (auto-detected by name match and manually linked).
                </p>
                <div className="border rounded-lg overflow-hidden bg-white dark:bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{useTrayNumber ? "Tray #" : "Patient"}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Lab</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Created</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Current job row */}
                      <tr className="border-b bg-primary/5">
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            {flaggedJobIds.includes(job.id) && (
                              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
                            )}
                            <span className="font-medium">{patientDisplayName}</span>
                            <span className="text-muted-foreground">(This job)</span>
                            {overdueJobIds.has(job.id) && (
                              <Badge className="text-[calc(10px*var(--ui-scale))] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getJobTypeBadgeColor(job.jobType); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getJobTypeLabel(job.jobType)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getStatusBadgeColor(job.status); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getStatusLabel(job.status)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getDestinationBadgeColor(job.orderDestination); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getDestinationLabel(job.orderDestination)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {format(new Date(job.createdAt), "MMM d, yyyy")}
                        </td>
                        <td className="px-3 py-2 text-xs"></td>
                      </tr>
                      {/* Related job rows */}
                      {relatedJobs.map((rj: any) => {
                        const rjDisplayName = useTrayNumber
                          ? (rj.trayNumber || "Tray not set")
                          : (formatPatientDisplayName(rj.patientFirstName, rj.patientLastName) || "Unnamed");
                        const rjTypeBadge = getJobTypeBadgeColor(rj.jobType);
                        const rjStatusBadge = getStatusBadgeColor(rj.status);
                        const rjDestBadge = getDestinationBadgeColor(rj.orderDestination);
                        const isClickable = !rj.archived && onSwitchJob;
                        return (
                          <tr
                            key={rj.id}
                            className={`border-b last:border-b-0 transition-colors ${isClickable ? "hover:bg-muted/30 cursor-pointer" : "hover:bg-muted/20"}`}
                            onClick={isClickable ? () => onSwitchJob!(rj.id) : undefined}
                          >
                            <td className="px-3 py-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                {flaggedJobIds.includes(rj.id) && (
                                  <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
                                )}
                                <span className="font-medium">{rjDisplayName}</span>
                                {rj.archived && (
                                  <Badge variant="secondary" className="text-[calc(10px*var(--ui-scale))] px-1 py-0">archived</Badge>
                                )}
                                {overdueJobIds.has(rj.id) && (
                                  <Badge className="text-[calc(10px*var(--ui-scale))] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjTypeBadge.background, color: rjTypeBadge.text }}>{getJobTypeLabel(rj.jobType)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjStatusBadge.background, color: rjStatusBadge.text }}>{getStatusLabel(rj.status)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjDestBadge.background, color: rjDestBadge.text }}>{getDestinationLabel(rj.orderDestination)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {format(new Date(rj.createdAt), "MMM d, yyyy")}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {rj.manualLink && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); unlinkMutation.mutate(rj.id); }}
                                  disabled={unlinkMutation.isPending}
                                >
                                  <Unlink className="h-3 w-3 mr-1" />
                                  Unlink
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Group Notes — shared across all linked jobs */}
                {linkGroupId && (
                  <div className="mt-6 rounded-lg border border-border bg-white dark:bg-card overflow-hidden">
                    {/* Section header */}
                    <div className="px-4 py-3 border-b border-border bg-muted/30 dark:bg-muted/10">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">Group Notes</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Shared across all linked jobs in this group.
                      </p>
                    </div>

                    {/* Notes list */}
                    <div className="divide-y divide-border/50">
                      {groupNotes.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                          No notes yet. Add one below.
                        </div>
                      )}
                      {groupNotes.map((note: any) => (
                        <div key={note.id} className="px-4 py-3 group hover:bg-muted/20 transition-colors">
                          <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {note.createdByName} &middot; {format(new Date(note.createdAt), "MMM d, yyyy h:mm a")}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => deleteGroupNoteMutation.mutate(note.id)}
                              disabled={deleteGroupNoteMutation.isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Composer */}
                    <div className="px-4 py-3 border-t border-border bg-muted/10">
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="Add a note..."
                          value={newGroupNote}
                          onChange={(e) => setNewGroupNote(e.target.value)}
                          className="min-h-[48px] text-sm resize-none bg-white dark:bg-background"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && newGroupNote.trim()) {
                              e.preventDefault();
                              addGroupNoteMutation.mutate(newGroupNote);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="shrink-0 h-auto"
                          disabled={!newGroupNote.trim() || addGroupNoteMutation.isPending}
                          onClick={() => addGroupNoteMutation.mutate(newGroupNote)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          )}

        </Tabs>

        {/* Footer — three-zone layout: left meta · centered status nav · right destructive/dismiss.
            Status mutation buttons sit dead-center so the user's eyes land on
            the primary lifecycle action rather than scanning a long row of
            mixed-purpose CTAs. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 py-3.5 border-t border-line bg-panel-2">
          <span className="flex items-center gap-1.5 text-[calc(11.5px*var(--ui-scale))] font-mono text-ink-mute justify-self-start">
            {lastUpdatedRelative ? (
              <>
                <Clock3 className="h-3 w-3" aria-hidden />
                Updated {lastUpdatedRelative}
              </>
            ) : null}
          </span>
          <div className="flex items-center gap-2 justify-self-center">
            {previousStatus && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateStatusMutation.mutate(previousStatus.id)}
                data-testid="button-revert-status"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Revert to {previousStatus.label}
              </Button>
            )}
            {nextStatus && (
              <Button
                size="sm"
                onClick={() => updateStatusMutation.mutate(nextStatus.id)}
                data-testid="button-advance-status"
              >
                Advance to {nextStatus.label}
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditJob(job)}
              data-testid="button-edit-job-from-details"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
