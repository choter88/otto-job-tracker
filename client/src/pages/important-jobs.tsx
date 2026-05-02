import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { getTypeBadgeStyle } from "@/lib/default-colors";
import { formatPatientDisplayName } from "@shared/name-format";
import { SubAccent, SubDot } from "@/components/page-head";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";
import JobDialog from "@/components/job-dialog";
import { cn } from "@/lib/utils";
import type { Job } from "@shared/schema";

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
  commentCount?: number;
}

export default function ImportantJobs() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

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

  const customJobTypes = office?.settings?.customJobTypes || [];

  const getJobTypeLabel = (jobTypeId: string) =>
    customJobTypes.find((t: any) => t.id === jobTypeId)?.label ||
    jobTypeId.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase());

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

  // The Job Details modal mounts in place — clicking a starred row opens it
  // here rather than navigating to the Worklist. The modal queries its own
  // office/status-history/related data, so we just hand it the selected
  // job. JobDialog is mounted alongside for the modal's "Edit" CTA.
  const [selectedJobForDetails, setSelectedJobForDetails] = useState<FlaggedJob | null>(null);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [jobDetailsTab, setJobDetailsTab] = useState<JobDetailsTab>("overview");
  const [editingJob, setEditingJob] = useState<Job | undefined>(undefined);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);

  const openJob = (job: FlaggedJob, panel: JobDetailsTab = "overview") => {
    setSelectedJobForDetails(job);
    setJobDetailsTab(panel);
    setJobDetailsOpen(true);
  };

  const handleStartEditingJob = (job: Job) => {
    setEditingJob(job);
    setJobDialogOpen(true);
  };

  const flaggedJobIds = useMemo(
    () => (flaggedJobs || []).map((j) => j.id),
    [flaggedJobs],
  );

  if (isLoading) {
    return (
      <div data-testid="page-important-jobs">
        <Skeleton className="h-5 w-72 mb-4" />
        <div className="bg-panel border border-line rounded-xl overflow-hidden">
          <div className="p-3 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!flaggedJobs || flaggedJobs.length === 0) {
    return (
      <div data-testid="page-important-jobs">
        <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mb-4">
          Nothing starred right now
        </p>
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
      {/* Topbar already crumb-labels this page "Starred". A thin metadata
          line keeps the page feeling alive without a redundant H1. */}
      <div className="mb-4 flex items-center gap-2 flex-wrap text-[calc(13px*var(--ui-scale))] text-ink-mute tracking-[-0.005em]">
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
      </div>

      {/* Table view — three columns, one row per starred job. The note
          ("Why starred") gets the most horizontal space because it IS the
          reason this list exists. Clicking anywhere on the row opens the
          shared Job Details modal in place — same chrome/Star toggle the
          worklist uses, so unstarring + comments + edit happens through
          the same surface. */}
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <Table className="text-[calc(13px*var(--ui-scale))] [&_th]:h-[34px] [&_th]:px-[14px] [&_th]:text-[calc(10.5px*var(--ui-scale))] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.10em] [&_th]:text-ink-mute [&_td]:px-[14px] [&_td]:py-2 [&_td]:h-[calc(48px*var(--ui-scale))] [&_td]:max-h-[calc(48px*var(--ui-scale))] [&_td]:align-middle [&_td]:overflow-hidden">
          <TableHeader className="[&_tr]:border-b [&_tr]:border-line [&_th]:bg-panel">
            <TableRow>
              <TableHead className="min-w-[180px] text-left">Patient</TableHead>
              <TableHead className="min-w-[120px]">Type</TableHead>
              <TableHead className="text-left">Why starred</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flaggedJobs.map((job) => {
              const patientName =
                formatPatientDisplayName(job.patientFirstName, job.patientLastName) ||
                job.trayNumber ||
                "Unnamed";
              const jobTypeBadge = getTypeBadgeStyle(job.jobType, customJobTypes);
              const noteText = (job.importantNote || "").trim();
              return (
                <TableRow
                  key={job.id}
                  className={cn(
                    "cursor-pointer transition-colors border-b border-line-2 last:border-b-0",
                    "bg-panel hover:bg-panel-2",
                  )}
                  onClick={() => openJob(job, "overview")}
                  data-testid={`row-starred-${job.id}`}
                >
                  <TableCell className="text-left">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Star
                        className="shrink-0 h-3.5 w-3.5 text-warn"
                        aria-hidden
                      />
                      <span className="font-medium text-ink truncate">
                        {patientName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className="border-0 max-w-[160px] truncate"
                      style={{
                        backgroundColor: jobTypeBadge.background,
                        color: jobTypeBadge.text,
                      }}
                    >
                      {getJobTypeLabel(job.jobType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    {noteText ? (
                      <span
                        className="text-ink-2 italic truncate block"
                        title={noteText}
                      >
                        &ldquo;{noteText}&rdquo;
                      </span>
                    ) : (
                      <span className="text-ink-faint italic">No note</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Job Details modal — same one the Worklist mounts. Renders here so
          clicking a starred row stays on this page instead of routing to
          the worklist. */}
      {selectedJobForDetails && (
        <JobDetailsModal
          open={jobDetailsOpen}
          onOpenChange={setJobDetailsOpen}
          job={selectedJobForDetails as unknown as Job}
          activeTab={jobDetailsTab}
          onActiveTabChange={setJobDetailsTab}
          onEditJob={handleStartEditingJob}
          flaggedJobIds={flaggedJobIds}
        />
      )}

      {/* Edit dialog — wired so the modal's "Edit" button opens the same
          job form the Worklist uses. */}
      <JobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        job={editingJob}
      />
    </div>
  );
}
