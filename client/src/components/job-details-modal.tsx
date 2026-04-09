import { useMemo, useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock3, Edit, FileText, MessageSquare, History, Link2, Star, Unlink, Send, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import JobCommentsPanel from "@/components/job-comments-panel";
import { getStatusBadgeStyle, getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { formatPatientDisplayName } from "@shared/name-format";
import { apiRequest } from "@/lib/queryClient";
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

  const customStatuses = useMemo(() => (office?.settings?.customStatuses || []) as any[], [office?.settings?.customStatuses]);
  const customJobTypes = useMemo(() => (office?.settings?.customJobTypes || []) as any[], [office?.settings?.customJobTypes]);
  const customOrderDestinations = useMemo(
    () => (office?.settings?.customOrderDestinations || []) as any[],
    [office?.settings?.customOrderDestinations],
  );
  const customColumns = useMemo(
    () => ((office?.settings?.customColumns || []) as any[]).filter((col) => col.active),
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

  const getDestinationBadgeColor = (destination: string) =>
    getDestinationBadgeStyle(destination, customOrderDestinations);

  if (!job) return null;

  const patientDisplayName = useTrayNumber
    ? job.trayNumber || "Tray not set"
    : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed patient";

  const statusBadgeColor = getStatusBadgeColor(job.status);
  const jobTypeBadgeColor = getJobTypeBadgeColor(job.jobType);
  const destinationBadgeColor = getDestinationBadgeColor(job.orderDestination);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-5xl flex flex-col p-0" data-testid="dialog-job-details">
        <SheetHeader className="space-y-3 p-6 pb-0 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-2xl">{patientDisplayName}</SheetTitle>
              <SheetDescription>
                Created {format(new Date(job.createdAt), "MMM d, yyyy 'at' h:mm a")}
              </SheetDescription>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge
                  className="border-0"
                  style={{ backgroundColor: statusBadgeColor.background, color: statusBadgeColor.text }}
                >
                  {getStatusLabel(job.status)}
                </Badge>
                <Badge
                  className="border-0"
                  style={{ backgroundColor: jobTypeBadgeColor.background, color: jobTypeBadgeColor.text }}
                >
                  {getJobTypeLabel(job.jobType)}
                </Badge>
                <Badge
                  className="border-0"
                  style={{ backgroundColor: destinationBadgeColor.background, color: destinationBadgeColor.text }}
                >
                  {getDestinationLabel(job.orderDestination)}
                </Badge>
                {job.isRedoJob && <Badge variant="secondary">Redo</Badge>}
              </div>
            </div>

            <Button
              onClick={() => onEditJob(job)}
              className="shrink-0 mr-6"
              data-testid={`button-edit-job-details-${job.id}`}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit Job
            </Button>
          </div>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as JobDetailsTab)}
          className="flex-1 flex flex-col min-h-0 px-6 pb-6"
        >
          <TabsList className={`grid w-full ${relatedJobs.length > 0 ? "grid-cols-3" : "grid-cols-2"} bg-muted h-11 p-1 rounded-lg`}>
            <TabsTrigger
              value="overview"
              className="rounded-md text-sm font-medium data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background data-[state=inactive]:hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              data-testid="tab-job-details-overview"
            >
              <FileText className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="comments"
              className="rounded-md text-sm font-medium data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background data-[state=inactive]:hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              data-testid="tab-job-details-comments"
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Comments
            </TabsTrigger>
            {relatedJobs.length > 0 && (
              <TabsTrigger
                value="related"
                className="rounded-md text-sm font-medium data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background data-[state=inactive]:hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                data-testid="tab-job-details-related"
              >
                <Link2 className="mr-2 h-4 w-4" />
                Related ({relatedJobs.length + 1})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="flex-1 min-h-0 mt-4 overflow-y-auto pr-1">
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-md border border-border p-4 border-l-[3px] border-l-primary bg-card dark:bg-muted/30">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Job Details</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">{useTrayNumber ? "Tray #" : "Patient"}</span>
                      <span className="font-medium text-right">{patientDisplayName}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Phone</span>
                      <span className="font-medium text-right">{job.phone || "—"}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Job Type</span>
                      <span className="font-medium text-right">{getJobTypeLabel(job.jobType)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium text-right">{getStatusLabel(job.status)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Destination</span>
                      <span className="font-medium text-right">{getDestinationLabel(job.orderDestination)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Created</span>
                      <span className="font-medium text-right">
                        {format(new Date(job.createdAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Last updated</span>
                      <span className="font-medium text-right">
                        {format(new Date(job.updatedAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Status changed</span>
                      <span className="font-medium text-right">
                        {format(new Date(job.statusChangedAt || job.createdAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border p-4 border-l-[3px] border-l-green-500 bg-card dark:bg-muted/30">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Notes & Custom Fields</h3>

                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">Notes</p>
                    <div className="rounded-md border border-border bg-muted/40 p-3 min-h-[80px]">
                      {job.notes?.trim() ? (
                        <p className="whitespace-pre-wrap">{job.notes}</p>
                      ) : (
                        <p className="text-muted-foreground">No notes added.</p>
                      )}
                    </div>
                  </div>

                  {customColumns.length > 0 ? (
                    <div className="space-y-2">
                      {customColumns.map((column) => {
                        const value = (job.customColumnValues as Record<string, any>)?.[column.id];
                        const displayValue =
                          column.type === "checkbox" ? (value ? "Yes" : "No") : value || "—";

                        return (
                          <div key={column.id} className="flex items-start justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{column.name}</span>
                            <span className="font-medium text-right">{displayValue}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No custom fields configured.</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <History className="h-3.5 w-3.5" />
                  Status History
                </h3>

                {historyLoading ? (
                  <div className="rounded-md border border-border p-6 text-center text-muted-foreground">
                    Loading history...
                  </div>
                ) : statusHistory.length === 0 ? (
                  <div className="rounded-md border border-border p-6 text-center text-muted-foreground">
                    No status history available for this job.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {statusHistory.map((entry) => {
                      const actorName =
                        entry.changedByUser?.firstName || entry.changedByUser?.lastName
                          ? `${entry.changedByUser?.firstName || ""} ${entry.changedByUser?.lastName || ""}`.trim()
                          : "System";
                      const oldLabel = entry.oldStatus ? getStatusLabel(entry.oldStatus) : "Created";
                      const newLabel = getStatusLabel(entry.newStatus);

                      return (
                        <div
                          key={entry.id}
                          className="rounded-md border border-border bg-muted/30 px-4 py-2.5 flex items-start gap-3"
                        >
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                            entry.newStatus === "completed" ? "bg-green-500" :
                            entry.newStatus === "cancelled" ? "bg-red-400" :
                            entry.oldStatus === null ? "bg-blue-500" :
                            "bg-muted-foreground/50"
                          }`} />
                          <div className="flex-1 flex items-start justify-between gap-4 min-w-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {entry.oldStatus ? `${oldLabel} → ${newLabel}` : `Initial status: ${newLabel}`}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="h-3 w-3" />
                                {format(new Date(entry.changedAt), "MMM d, yyyy h:mm a")}
                              </span>
                              <span>•</span>
                              <span>{actorName}</span>
                            </p>
                          </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comments" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <div className="h-full rounded-md border border-border overflow-hidden bg-white dark:bg-card">
              <JobCommentsPanel
                job={job}
                header={
                  <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Comments</span>
                  </div>
                }
              />
            </div>
          </TabsContent>

          {/* Related Jobs tab — auto-detected by patient name match + manually linked */}
          {relatedJobs.length > 0 && (
            <TabsContent value="related" className="flex-1 min-h-0 mt-4 overflow-y-auto pr-1">
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
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Destination</th>
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
                              <Badge className="text-[10px] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
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
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">archived</Badge>
                                )}
                                {overdueJobIds.has(rj.id) && (
                                  <Badge className="text-[10px] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
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
      </SheetContent>
    </Sheet>
  );
}
