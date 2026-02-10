import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Star, MessageSquare, NotebookPen, Save } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import CommentsSidebar from "@/components/comments-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { getColorForBadge, getDefaultDestinationColor, getDefaultJobTypeColor, getDefaultStatusColor } from "@/lib/default-colors";

interface FlaggedJob {
  id: string;
  orderId: string;
  patientFirstName: string;
  patientLastName: string;
  phone: string | null;
  jobType: string;
  status: string;
  orderDestination: string;
  officeId: string;
  createdBy: string | null;
  statusChangedAt: string;
  customColumnValues: any;
  isRedoJob: boolean;
  originalJobId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  summary?: string | null;
  summaryGeneratedAt?: string | null;
  flaggedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

export default function ImportantJobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [commentsSidebarOpen, setCommentsSidebarOpen] = useState(false);
  const [selectedJobForComments, setSelectedJobForComments] = useState<FlaggedJob | undefined>();

  const { data: flaggedJobs, isLoading } = useQuery<FlaggedJob[]>({
    queryKey: ["/api/jobs/flagged"],
  });

  const { data: officeData } = useQuery({
    queryKey: ["/api/user"],
    select: (data: any) => data?.officeId ? { officeId: data.officeId } : null,
  });

  const { data: office } = useQuery<any>({
    queryKey: ["/api/offices", officeData?.officeId],
    enabled: !!officeData?.officeId,
  });

  const unflagMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return apiRequest("DELETE", `/api/jobs/${jobId}/flag`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
      toast({
        title: "Success",
        description: "Job unflagged successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to unflag job",
        variant: "destructive",
      });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ jobId, note }: { jobId: string; note: string }) => {
      const res = await apiRequest("PUT", `/api/jobs/${jobId}/flag/note`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
      toast({
        title: "Saved",
        description: "Important note updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save important note",
        variant: "destructive",
      });
    },
  });

  const handleOpenComments = (job: FlaggedJob) => {
    setSelectedJobForComments(job);
    setCommentsSidebarOpen(true);
  };

  const getStatusLabel = (statusId: string) => {
    const status = office?.settings?.customStatuses?.find((s: any) => s.id === statusId);
    return status?.label || statusId;
  };

  const getJobTypeLabel = (jobTypeId: string) => {
    const jobType = office?.settings?.customJobTypes?.find((t: any) => t.id === jobTypeId);
    return jobType?.label || jobTypeId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getDestinationLabel = (destId: string) => {
    const destination = office?.settings?.customOrderDestinations?.find((d: any) => d.id === destId || d.label === destId);
    return destination?.label || destId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getStatusBadgeStyle = (statusId: string) => {
    const customStatus = office?.settings?.customStatuses?.find((s: any) => s.id === statusId);
    if (customStatus) {
      const colorValue = customStatus.hsl || customStatus.color || customStatus.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }

    const def = getDefaultStatusColor(statusId);
    if (def) return getColorForBadge(def.hsl);
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

  const getJobTypeBadgeStyle = (jobTypeId: string) => {
    const customType = office?.settings?.customJobTypes?.find((t: any) => t.id === jobTypeId);
    if (customType) {
      const colorValue = customType.hsl || customType.color || customType.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }

    const def = getDefaultJobTypeColor(jobTypeId);
    if (def) return getColorForBadge(def.hsl);
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

  const getDestinationBadgeStyle = (destId: string) => {
    const customDestination = office?.settings?.customOrderDestinations?.find((d: any) => d.id === destId || d.label === destId);
    if (customDestination) {
      const colorValue = customDestination.hsl || customDestination.color || customDestination.hex;
      if (colorValue) return getColorForBadge(colorValue);
    }

    const def = getDefaultDestinationColor(destId);
    if (def) return getColorForBadge(def.hsl);
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="page-important-jobs">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!flaggedJobs || flaggedJobs.length === 0) {
    return (
      <div data-testid="page-important-jobs">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Star className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-xl font-semibold mb-2">No jobs flagged as important</p>
            <p className="text-muted-foreground text-center max-w-md">
              Star jobs from the Worklist to track them here. You and your team can flag jobs that need special attention.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4" data-testid="page-important-jobs">
        {flaggedJobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onOpenComments={() => handleOpenComments(job)}
            onUnflag={() => unflagMutation.mutate(job.id)}
            canEditNote={job.flaggedBy?.id === user?.id}
            savingNote={updateNoteMutation.isPending}
            onSaveNote={(note) => updateNoteMutation.mutateAsync({ jobId: job.id, note })}
            getStatusLabel={getStatusLabel}
            getJobTypeLabel={getJobTypeLabel}
            getDestinationLabel={getDestinationLabel}
            getStatusBadgeStyle={getStatusBadgeStyle}
            getJobTypeBadgeStyle={getJobTypeBadgeStyle}
            getDestinationBadgeStyle={getDestinationBadgeStyle}
          />
        ))}
      </div>

      {/* Comments Sidebar */}
      {selectedJobForComments && (
        <CommentsSidebar
          open={commentsSidebarOpen}
          onOpenChange={setCommentsSidebarOpen}
          job={selectedJobForComments as any}
        />
      )}
    </>
  );
}

interface JobCardProps {
  job: FlaggedJob;
  onOpenComments: () => void;
  onUnflag: () => void;
  canEditNote: boolean;
  savingNote: boolean;
  onSaveNote: (note: string) => Promise<void>;
  getStatusLabel: (statusId: string) => string;
  getJobTypeLabel: (jobTypeId: string) => string;
  getDestinationLabel: (destId: string) => string;
  getStatusBadgeStyle: (statusId: string) => { background: string; text: string };
  getJobTypeBadgeStyle: (jobTypeId: string) => { background: string; text: string };
  getDestinationBadgeStyle: (destId: string) => { background: string; text: string };
}

function JobCard({
  job,
  onOpenComments,
  onUnflag,
  canEditNote,
  savingNote,
  onSaveNote,
  getStatusLabel,
  getJobTypeLabel,
  getDestinationLabel,
  getStatusBadgeStyle,
  getJobTypeBadgeStyle,
  getDestinationBadgeStyle,
}: JobCardProps) {
  const patientName = `${job.patientFirstName} ${job.patientLastName}`.trim();
  const statusLabel = getStatusLabel(job.status);
  const jobTypeLabel = getJobTypeLabel(job.jobType);
  const destinationLabel = getDestinationLabel(job.orderDestination);
  const [noteDraft, setNoteDraft] = useState(job.summary || "");
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);

  useEffect(() => {
    setNoteDraft(job.summary || "");
  }, [job.id, job.summary]);

  const statusBadgeStyle = getStatusBadgeStyle(job.status);
  const jobTypeBadgeStyle = getJobTypeBadgeStyle(job.jobType);
  const destinationBadgeStyle = getDestinationBadgeStyle(job.orderDestination);

  const summaryText = (job.summary || "").trim();
  const summaryPreview = summaryText.replace(/\s+/g, " ");
  const noteActionLabel = canEditNote
    ? summaryText
      ? "Edit note"
      : "Add note"
    : summaryText
      ? "View note"
      : null;

  return (
    <>
      <Card className="hover:shadow-soft transition-shadow" data-testid={`card-job-${job.id}`}>
        <CardContent className="p-4 space-y-2">
          {/* Row 1: Patient + badges + star */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="text-lg leading-6 truncate" data-testid={`text-patient-${job.id}`}>
                  {patientName}
                </CardTitle>

                {job.isRedoJob && (
                  <Badge variant="secondary" className="h-6" data-testid={`badge-redo-${job.id}`}>
                    Redo
                  </Badge>
                )}

                <Badge
                  className="h-6 border-0"
                  style={{ backgroundColor: jobTypeBadgeStyle.background, color: jobTypeBadgeStyle.text }}
                  data-testid={`badge-job-type-${job.id}`}
                  title={jobTypeLabel}
                >
                  <span className="max-w-[140px] truncate">{jobTypeLabel}</span>
                </Badge>

                <Badge
                  className="h-6 border-0"
                  style={{ backgroundColor: statusBadgeStyle.background, color: statusBadgeStyle.text }}
                  data-testid={`badge-status-${job.id}`}
                  title={statusLabel}
                >
                  <span className="max-w-[140px] truncate">{statusLabel}</span>
                </Badge>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onUnflag}
              disabled={!canEditNote}
              className="h-8 w-8"
              data-testid={`button-unflag-${job.id}`}
              title={canEditNote ? "Remove your star" : "Starred by a teammate"}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            </Button>
          </div>

          {/* Row 2: Metadata (single-line, truncated) */}
          <div className="text-xs text-muted-foreground truncate" title={`${job.orderId} · Destination: ${destinationLabel}`}>
            <span className="font-mono">{job.orderId}</span>
            <span className="mx-2">·</span>
            <span className="inline-flex items-center gap-1">
              <span>Destination:</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: destinationBadgeStyle.text }}
                />
                <span>{destinationLabel}</span>
              </span>
            </span>
            <span className="mx-2">·</span>
            <span>Created {format(new Date(job.createdAt), "MMM d, yyyy")}</span>
            <span className="mx-2">·</span>
            <span>Updated {format(new Date(job.updatedAt), "MMM d, yyyy")}</span>
            {job.flaggedBy && (
              <>
                <span className="mx-2">·</span>
                <span>
                  Flagged by {job.flaggedBy.firstName} {job.flaggedBy.lastName}
                </span>
              </>
            )}
          </div>

          {/* Row 3: Note preview + actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <NotebookPen className="h-4 w-4 text-primary flex-shrink-0" />
              <p
                className={`text-sm truncate ${summaryText ? "text-foreground" : "text-muted-foreground"}`}
                data-testid={`summary-${job.id}`}
                title={summaryText || "No important note yet."}
              >
                {summaryText ? summaryPreview : "No important note yet."}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {noteActionLabel && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNoteDialogOpen(true)}
                  data-testid={`button-note-${job.id}`}
                >
                  {noteActionLabel}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={onOpenComments}
                data-testid={`button-show-comments-${job.id}`}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Comments
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Note dialog (rich view, keeps list compact) */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="w-full max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Important note</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={canEditNote ? "Add a quick note your team should see…" : undefined}
              readOnly={!canEditNote}
              rows={8}
              data-testid={`textarea-important-note-${job.id}`}
            />

            {canEditNote && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {job.summaryGeneratedAt
                    ? `Last saved ${format(new Date(job.summaryGeneratedAt), "MMM d, h:mm a")}`
                    : "Not saved yet"}
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await onSaveNote(noteDraft);
                      setNoteDialogOpen(false);
                    } catch {
                      // Toast is handled by the mutation onError.
                    }
                  }}
                  disabled={savingNote}
                  data-testid={`button-save-important-note-${job.id}`}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {savingNote ? "Saving…" : "Save note"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
