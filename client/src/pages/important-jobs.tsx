import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  MessageSquare,
  NotebookPen,
  Save,
  Star,
  StickyNote,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import CommentsSidebar from "@/components/comments-sidebar";
import { useAuth } from "@/hooks/use-auth";
import {
  getStatusBadgeStyle,
  getTypeBadgeStyle,
  getDestinationBadgeStyle,
} from "@/lib/default-colors";
import { formatPatientDisplayName } from "@shared/name-format";
import PageHead, { SubAccent, SubDot } from "@/components/page-head";

interface FlaggedJob {
  id: string;
  orderId: string;
  patientFirstName: string;
  patientLastName: string;
  trayNumber?: string | null;
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
  importantNote?: string | null;
  importantNoteUpdatedAt?: string | null;
  aiSummary?: string | null;
  aiSummaryGeneratedAt?: string | null;
  flaggedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

export default function ImportantJobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [commentsSidebarOpen, setCommentsSidebarOpen] = useState(false);
  const [selectedJobForComments, setSelectedJobForComments] = useState<FlaggedJob | undefined>();

  const { data: flaggedJobs, isLoading } = useQuery<FlaggedJob[]>({
    queryKey: ["/api/jobs/flagged"],
  });

  const { data: officeData } = useQuery({
    queryKey: ["/api/user"],
    select: (data: any) => (data?.officeId ? { officeId: data.officeId } : null),
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
      toast({ title: "Star removed", description: "Job is no longer starred." });
    },
    onError: () => {
      toast({ title: "Couldn't unflag", description: "Try again in a moment.", variant: "destructive" });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ jobId, note }: { jobId: string; note: string }) => {
      const res = await apiRequest("PUT", `/api/jobs/${jobId}/flag/note`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
      toast({ title: "Saved", description: "Star note updated." });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't save",
        description: error.message || "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const handleOpenComments = (job: FlaggedJob) => {
    setSelectedJobForComments(job);
    setCommentsSidebarOpen(true);
  };

  // Open the Job Details modal that lives in JobsTable. We navigate to the
  // worklist root first so JobsTable mounts, then fire the custom event after
  // a frame so the listener is wired up. Same pattern as the notification bell.
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

  const customStatuses = office?.settings?.customStatuses || [];
  const customJobTypes = office?.settings?.customJobTypes || [];
  const customOrderDestinations = office?.settings?.customOrderDestinations || [];
  const jobIdentifierMode = office?.settings?.jobIdentifierMode || "patientName";
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  const getStatusLabel = (statusId: string) =>
    customStatuses.find((s: any) => s.id === statusId)?.label || statusId;
  const getJobTypeLabel = (jobTypeId: string) =>
    customJobTypes.find((t: any) => t.id === jobTypeId)?.label ||
    jobTypeId.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase());
  const getDestinationLabel = (destId: string) =>
    customOrderDestinations.find((d: any) => d.id === destId || d.label === destId)?.label ||
    destId.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase());

  const lastFlaggedAt = useMemo(() => {
    if (!flaggedJobs?.length) return null;
    let max: number | null = null;
    for (const j of flaggedJobs) {
      const ts = j.importantNoteUpdatedAt ? new Date(j.importantNoteUpdatedAt).getTime() : null;
      if (ts && (max === null || ts > max)) max = ts;
    }
    return max ? new Date(max) : null;
  }, [flaggedJobs]);

  const flaggedByMe = useMemo(
    () => (flaggedJobs || []).filter((j) => j.flaggedBy?.id === user?.id).length,
    [flaggedJobs, user?.id],
  );

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="page-important-jobs">
        <Skeleton className="h-12 w-72" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-panel border border-line rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (!flaggedJobs || flaggedJobs.length === 0) {
    return (
      <div data-testid="page-important-jobs">
        <PageHead
          title="Starred"
          className="mb-4"
          sub={<span>Nothing starred right now</span>}
        />
        <div className="bg-panel border border-line rounded-xl px-6 py-12 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-full bg-warn-bg/60 grid place-items-center mb-4 ring-1 ring-warn/20">
            <Star className="h-6 w-6 text-warn fill-warn" aria-hidden />
          </span>
          <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
            No starred jobs
          </h3>
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1.5 max-w-md">
            Open any job in the worklist and click the Star button to keep it
            close at hand. Add a note so your team knows why it matters.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-5"
            onClick={() => setLocation("/")}
            data-testid="button-go-worklist"
          >
            Go to Worklist
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="page-important-jobs">
      <PageHead
        title="Starred"
        className="mb-4"
        sub={
          <>
            <span>
              {flaggedJobs.length} starred job{flaggedJobs.length !== 1 ? "s" : ""}
            </span>
            {flaggedByMe > 0 && (
              <>
                <SubDot />
                <SubAccent>{flaggedByMe} starred by you</SubAccent>
              </>
            )}
            {lastFlaggedAt && (
              <>
                <SubDot />
                <span>last starred {formatDistanceToNow(lastFlaggedAt, { addSuffix: true })}</span>
              </>
            )}
          </>
        }
      />

      <div className="space-y-3">
        {flaggedJobs.map((job) => (
          <FlaggedJobCard
            key={job.id}
            job={job}
            useTrayNumber={useTrayNumber}
            onOpenComments={() => handleOpenComments(job)}
            onOpenDetails={() => handleOpenDetails(job.id)}
            onUnflag={() => unflagMutation.mutate(job.id)}
            canEditNote={job.flaggedBy?.id === user?.id}
            savingNote={updateNoteMutation.isPending}
            onSaveNote={(note) => updateNoteMutation.mutateAsync({ jobId: job.id, note })}
            getStatusLabel={getStatusLabel}
            getJobTypeLabel={getJobTypeLabel}
            getDestinationLabel={getDestinationLabel}
            getStatusBadgeStyle={(id: string) => getStatusBadgeStyle(id, customStatuses)}
            getJobTypeBadgeStyle={(id: string) => getTypeBadgeStyle(id, customJobTypes)}
            getDestinationBadgeStyle={(id: string) =>
              getDestinationBadgeStyle(id, customOrderDestinations)
            }
          />
        ))}
      </div>

      {selectedJobForComments && (
        <CommentsSidebar
          open={commentsSidebarOpen}
          onOpenChange={setCommentsSidebarOpen}
          job={selectedJobForComments as any}
        />
      )}
    </div>
  );
}

interface JobCardProps {
  job: FlaggedJob;
  useTrayNumber: boolean;
  onOpenComments: () => void;
  onOpenDetails: () => void;
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

function FlaggedJobCard({
  job,
  useTrayNumber,
  onOpenComments,
  onOpenDetails,
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
  const patientName = useTrayNumber
    ? job.trayNumber || "Tray not set"
    : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed";
  const statusLabel = getStatusLabel(job.status);
  const jobTypeLabel = getJobTypeLabel(job.jobType);
  const destinationLabel = getDestinationLabel(job.orderDestination);
  const [noteDraft, setNoteDraft] = useState(job.importantNote || "");
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);

  useEffect(() => {
    setNoteDraft(job.importantNote || "");
  }, [job.id, job.importantNote]);

  const statusBadge = getStatusBadgeStyle(job.status);
  const jobTypeBadge = getJobTypeBadgeStyle(job.jobType);
  const destinationBadge = getDestinationBadgeStyle(job.orderDestination);

  const noteText = (job.importantNote || "").trim();
  const flaggedByName = job.flaggedBy
    ? `${job.flaggedBy.firstName || ""} ${job.flaggedBy.lastName || ""}`.trim() || null
    : null;
  const flaggedAt = job.importantNoteUpdatedAt ? new Date(job.importantNoteUpdatedAt) : null;

  const initials =
    (patientName || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0] || "")
      .join("")
      .toUpperCase() || "?";

  return (
    <>
      <div
        className="bg-panel border border-line rounded-xl p-4 space-y-3 hover:shadow-soft transition-shadow"
        data-testid={`card-job-${job.id}`}
      >
        {/* Header row — avatar, name, badges, unflag */}
        <div className="flex items-start gap-3">
          <span
            className="w-10 h-10 rounded-full grid place-items-center text-[calc(11.5px*var(--ui-scale))] font-semibold tracking-wider shrink-0 ring-1 ring-inset ring-line"
            style={{ backgroundColor: statusBadge.background, color: statusBadge.text }}
            aria-hidden
            data-testid={`avatar-${job.id}`}
          >
            {initials}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className="font-display text-[calc(17px*var(--ui-scale))] font-medium tracking-[-0.015em] text-ink m-0 leading-tight"
                data-testid={`text-patient-${job.id}`}
              >
                {patientName}
              </h3>
              <Badge
                className="border-0"
                style={{ backgroundColor: jobTypeBadge.background, color: jobTypeBadge.text }}
                data-testid={`badge-job-type-${job.id}`}
              >
                <span className="max-w-[160px] truncate">{jobTypeLabel}</span>
              </Badge>
              <Badge
                className="border-0"
                style={{ backgroundColor: statusBadge.background, color: statusBadge.text }}
                data-testid={`badge-status-${job.id}`}
              >
                <span className="max-w-[160px] truncate">{statusLabel}</span>
              </Badge>
              {job.isRedoJob && (
                <Badge
                  className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  data-testid={`badge-redo-${job.id}`}
                >
                  REDO
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[calc(12px*var(--ui-scale))] text-ink-mute">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: destinationBadge.text }}
                  aria-hidden
                />
                {destinationLabel}
              </span>
              <span className="text-ink-faint">·</span>
              <span>Updated {formatDistanceToNow(new Date(job.updatedAt), { addSuffix: true })}</span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onUnflag}
            disabled={!canEditNote}
            className="h-8 w-8 shrink-0"
            title={canEditNote ? "Remove your star" : "Starred by a teammate"}
            data-testid={`button-unflag-${job.id}`}
          >
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          </Button>
        </div>

        {/* Sticky-note treatment for the flag note — same amber rail as the
            Notes block in the Job Details modal so the two views feel like
            family. */}
        <div className="rounded-lg bg-warn-bg/40 border border-warn/15 border-l-[3px] border-l-warn/60 px-3.5 py-2.5">
          {noteText ? (
            <p
              className="text-[calc(13px*var(--ui-scale))] text-ink-2 whitespace-pre-wrap leading-relaxed m-0"
              data-testid={`text-note-${job.id}`}
            >
              {noteText}
            </p>
          ) : (
            <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute italic m-0">
              No note yet — add one so your team knows why this matters.
            </p>
          )}
          {(flaggedByName || flaggedAt) && (
            <div className="flex items-center gap-1.5 mt-2 text-[calc(11px*var(--ui-scale))] text-ink-mute">
              <StickyNote className="h-3 w-3" aria-hidden />
              {flaggedByName && (
                <span>
                  &mdash; {flaggedByName}
                  {flaggedByName.toLowerCase() === "system" ? "" : ""}
                </span>
              )}
              {flaggedByName && flaggedAt && <span className="text-ink-faint">·</span>}
              {flaggedAt && (
                <span className="font-mono">{format(flaggedAt, "MMM d · h:mm a")}</span>
              )}
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-end gap-2">
          {(canEditNote || noteText) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNoteDialogOpen(true)}
              data-testid={`button-note-${job.id}`}
            >
              <NotebookPen className="h-3.5 w-3.5 mr-1.5" />
              {canEditNote ? (noteText ? "Edit note" : "Add note") : "View note"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenComments}
            data-testid={`button-show-comments-${job.id}`}
          >
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
            Comments
          </Button>
          <Button
            size="sm"
            onClick={onOpenDetails}
            data-testid={`button-open-details-${job.id}`}
          >
            Open
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </div>
      </div>

      {/* Note dialog — full editor */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="w-full max-w-xl">
          <DialogHeader>
            <DialogTitle asChild>
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-warn" />
                <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
                  Star note
                </h3>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={
                canEditNote ? "Add a quick note your team should see…" : undefined
              }
              readOnly={!canEditNote}
              rows={8}
              className="resize-none bg-warn-bg/30 border-warn/20 focus-visible:ring-warn/40"
              data-testid={`textarea-important-note-${job.id}`}
            />
            <div className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute">
              {flaggedAt
                ? `Last saved ${format(flaggedAt, "MMM d, h:mm a")}`
                : canEditNote
                  ? "Not saved yet"
                  : ""}
            </div>
          </div>

          {canEditNote && (
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNoteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await onSaveNote(noteDraft);
                    setNoteDialogOpen(false);
                  } catch {
                    /* toast handled by the mutation onError */
                  }
                }}
                disabled={savingNote}
                data-testid={`button-save-important-note-${job.id}`}
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {savingNote ? "Saving…" : "Save note"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
