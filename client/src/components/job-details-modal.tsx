import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock3, Edit, FileText, MessageSquare, History, Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import JobCommentsPanel from "@/components/job-comments-panel";
import { getColorForBadge, getDefaultDestinationColor, getDefaultJobTypeColor, getDefaultStatusColor } from "@/lib/default-colors";
import { formatPatientDisplayName } from "@shared/name-format";
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
}: JobDetailsModalProps) {
  const { user } = useAuth();

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

  const { data: relatedJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs", job?.id, "related"],
    queryFn: async () => {
      if (!job?.id) return [];
      const res = await fetch(`/api/jobs/${job.id}/related`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!job?.id && open,
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

  const getStatusBadgeColor = (status: string) => {
    const customStatus = customStatuses.find((entry) => entry.id === status);
    if (customStatus) {
      const colorValue = customStatus.hsl || customStatus.color || customStatus.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }
    const fallback = getDefaultStatusColor(status);
    if (fallback) return getColorForBadge(fallback.hsl);
    return { background: "hsl(0 0% 90% / 0.15)", text: "hsl(0 0% 40%)" };
  };

  const getJobTypeBadgeColor = (jobType: string) => {
    const customType = customJobTypes.find((entry) => entry.id === jobType);
    if (customType) {
      const colorValue = customType.hsl || customType.color || customType.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }
    const fallback = getDefaultJobTypeColor(jobType);
    if (fallback) return getColorForBadge(fallback.hsl);
    return { background: "hsl(0 0% 90% / 0.15)", text: "hsl(0 0% 40%)" };
  };

  const getDestinationBadgeColor = (destination: string) => {
    const customDestination = customOrderDestinations.find(
      (entry) => entry.id === destination || entry.label === destination,
    );
    if (customDestination) {
      const colorValue = customDestination.hsl || customDestination.color || customDestination.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }
    const destinationLabel = getDestinationLabel(destination);
    const fallback = getDefaultDestinationColor(destinationLabel) || getDefaultDestinationColor(destination);
    if (fallback) return getColorForBadge(fallback.hsl);
    return { background: "hsl(0 0% 90% / 0.15)", text: "hsl(0 0% 40%)" };
  };

  if (!job) return null;

  const patientDisplayName = useTrayNumber
    ? job.trayNumber || "Tray not set"
    : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed patient";

  const statusBadgeColor = getStatusBadgeColor(job.status);
  const jobTypeBadgeColor = getJobTypeBadgeColor(job.jobType);
  const destinationBadgeColor = getDestinationBadgeColor(job.orderDestination);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-5xl h-[86vh] max-h-[86vh] flex flex-col" data-testid="dialog-job-details">
        <DialogHeader className="space-y-3 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-2xl">{patientDisplayName}</DialogTitle>
              <DialogDescription>
                Created {format(new Date(job.createdAt), "MMM d, yyyy 'at' h:mm a")}
              </DialogDescription>
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
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as JobDetailsTab)}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className={`grid w-full ${relatedJobs.length > 0 ? "grid-cols-3" : "grid-cols-2"} bg-muted/60`}>
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              data-testid="tab-job-details-overview"
            >
              <FileText className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="comments"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              data-testid="tab-job-details-comments"
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Comments
            </TabsTrigger>
            {relatedJobs.length > 0 && (
              <TabsTrigger
                value="related"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                data-testid="tab-job-details-related"
              >
                <Link2 className="mr-2 h-4 w-4" />
                Related ({relatedJobs.length})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="flex-1 min-h-0 mt-4 overflow-y-auto pr-1">
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-md border border-border p-4 border-l-[3px] border-l-primary">
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

                <div className="rounded-md border border-border p-4 border-l-[3px] border-l-green-500">
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
            <div className="h-full rounded-md border border-border overflow-hidden">
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

          {/* Related Jobs tab — auto-detected by patient name match */}
          {relatedJobs.length > 0 && (
            <TabsContent value="related" className="flex-1 min-h-0 mt-4 overflow-y-auto pr-1">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Other jobs for this patient, detected automatically by matching name.
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Job Type</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Destination</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedJobs.map((rj: any) => (
                        <tr key={rj.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 text-xs">
                            <Badge variant="secondary" className="text-xs">{getJobTypeLabel(rj.jobType)}</Badge>
                            {rj.archived && (
                              <Badge variant="secondary" className="ml-1 text-[10px]">archived</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{getStatusLabel(rj.status)}</td>
                          <td className="px-3 py-2 text-xs">{getDestinationLabel(rj.orderDestination)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {format(new Date(rj.createdAt), "MMM d, yyyy")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          )}

        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
