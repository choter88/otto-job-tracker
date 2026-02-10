import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    return jobType?.label || jobTypeId;
  };

  const getDestinationLabel = (destId: string) => {
    const destination = office?.settings?.destinations?.find((d: any) => d.id === destId);
    return destination?.label || destId;
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
            onSaveNote={(note) => updateNoteMutation.mutate({ jobId: job.id, note })}
            getStatusLabel={getStatusLabel}
            getJobTypeLabel={getJobTypeLabel}
            getDestinationLabel={getDestinationLabel}
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
  onSaveNote: (note: string) => void;
  getStatusLabel: (statusId: string) => string;
  getJobTypeLabel: (jobTypeId: string) => string;
  getDestinationLabel: (destId: string) => string;
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
}: JobCardProps) {
  const patientName = `${job.patientFirstName} ${job.patientLastName}`.trim();
  const statusLabel = getStatusLabel(job.status);
  const jobTypeLabel = getJobTypeLabel(job.jobType);
  const destinationLabel = getDestinationLabel(job.orderDestination);
  const [noteDraft, setNoteDraft] = useState(job.summary || "");

  useEffect(() => {
    setNoteDraft(job.summary || "");
  }, [job.id, job.summary]);

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`card-job-${job.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-xl" data-testid={`text-patient-${job.id}`}>
                {patientName}
              </CardTitle>
              <Badge variant="outline" data-testid={`badge-job-type-${job.id}`}>
                {jobTypeLabel}
              </Badge>
              <Badge data-testid={`badge-status-${job.id}`}>{statusLabel}</Badge>
            </div>
            <CardDescription className="flex items-center gap-4 flex-wrap">
              <span>Order ID: {job.orderId}</span>
              <span>Destination: {destinationLabel}</span>
              <span>Created: {format(new Date(job.createdAt), "MMM d, yyyy")}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnflag}
              data-testid={`button-unflag-${job.id}`}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            </Button>
          </div>
        </div>
        {job.flaggedBy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <span>
              Flagged by: {job.flaggedBy.firstName} {job.flaggedBy.lastName}
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Important note */}
        <div className="bg-muted/50 rounded-lg p-4" data-testid={`summary-${job.id}`}>
          <div className="flex items-center gap-2 mb-2">
            <NotebookPen className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Important note</span>
          </div>
          {canEditNote ? (
            <div className="space-y-3">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add a quick note your team should see…"
                rows={3}
                data-testid={`textarea-important-note-${job.id}`}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {job.summaryGeneratedAt
                    ? `Last saved ${format(new Date(job.summaryGeneratedAt), "MMM d, h:mm a")}`
                    : "Not saved yet"}
                </div>
                <Button
                  size="sm"
                  onClick={() => onSaveNote(noteDraft)}
                  disabled={savingNote}
                  data-testid={`button-save-important-note-${job.id}`}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {savingNote ? "Saving…" : "Save note"}
                </Button>
              </div>
            </div>
          ) : job.summary ? (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{job.summary}</p>
              {job.summaryGeneratedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last saved {format(new Date(job.summaryGeneratedAt), "MMM d, h:mm a")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No important note yet.</p>
          )}
        </div>

        {/* Show Comments Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenComments}
          className="w-full"
          data-testid={`button-show-comments-${job.id}`}
        >
          <MessageSquare className="h-4 w-4 mr-2" />
          Show Comments
        </Button>
      </CardContent>
    </Card>
  );
}
