import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { resolveTodayConfig, TEAM_ACTIVITY_FILTER, type TodayConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";
import JobQueueTile from "@/components/today/job-queue-tile";
import StarredTile from "@/components/today/starred-tile";
import ActivityTile from "@/components/today/activity-tile";
import TileEditDialog from "@/components/today/tile-edit-popover";
import TodayIntroBanner from "@/components/today/today-intro-banner";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TODAY_EVENTS } from "@shared/today-telemetry";

// Thin wrapper around POST /api/track for Today Dashboard v2 client events,
// same pattern as client/src/components/topbar.tsx and today/starred-tile.tsx
// (not shared/exported from there; kept local to each file on purpose).
// Fire-and-forget: telemetry failures must never break the UI. Metadata is
// numbers/enums only so PHI can never be logged from the client.
function trackTodayEvent(eventType: (typeof TODAY_EVENTS)[keyof typeof TODAY_EVENTS]) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType, metadata: {} }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export default function Today() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: office } = useQuery<any>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  // M10: fire once per mount (empty dep array), not per render/re-fetch.
  useEffect(() => {
    trackTodayEvent(TODAY_EVENTS.VIEW_OPENED);
  }, []);

  const customStatuses: Array<{ id: string; label: string; color?: string; order?: number }> =
    office?.settings?.customStatuses ?? [];
  const validStatusIds = customStatuses.map((s) => s.id);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(
    () => resolveTodayConfig(user?.preferences, user?.role ?? "staff", validStatusIds),
    [user?.preferences, user?.role, validStatusIds.join(",")],
  );

  // Shared modal state (the important-jobs.tsx pattern).
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<JobDetailsTab>("overview");
  const [modalOverdue, setModalOverdue] = useState(false);
  const openJob = (job: Job, tab: JobDetailsTab = "overview", overdue = false) => {
    setSelectedJob(job);
    setModalTab(tab);
    setModalOverdue(overdue);
    setModalOpen(true);
  };

  // Lookup for activity rows → full Job (so a feed row can open the modal).
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  // Edit dialog state (Task 13). "activity" kind removed in M8: the Team
  // activity feed's filter is fixed (TEAM_ACTIVITY_FILTER), not user-editable,
  // so the old "Since last login" filter editor has no entry point anymore.
  const [editState, setEditState] = useState<
    { kind: "queue"; slotIndex: number } | null
  >(null);

  const queryClient = useQueryClient();
  const savePrefs = useMutation({
    mutationFn: async (todayConfig: TodayConfig) => {
      await apiRequest("PUT", "/api/user/preferences", { todayConfig });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
    onError: (e: any) =>
      toast({ title: "Couldn't save your Today layout", description: e?.message, variant: "destructive" }),
  });

  const openEditFor = (i: number) => setEditState({ kind: "queue", slotIndex: i });
  const onSaveConfig = (next: TodayConfig) => {
    savePrefs.mutate(next);
    setEditState(null);
  };

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      {user?.id && <TodayIntroBanner userId={user.id} />}
      <div className="flex-1 min-h-0 flex gap-4">
      {/* Left column: queue tiles split the height and each scrolls on its own. */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">
        {config.slots.map((slot, i) =>
          slot.type === "queue" && (slot.mode === "outreach" || slot.mode === "chase") ? (
            <div key={i} className="flex-1 min-h-0 flex flex-col" data-testid={`today-slot-${i}`}>
              <JobQueueTile slot={slot} jobs={jobs} office={office} onOpenJob={openJob} onEdit={() => openEditFor(i)} />
            </div>
          ) : (
            <div key={i} data-testid={`today-slot-${i}`} />
          )
        )}
      </div>
      <div className="w-[360px] flex-none flex flex-col gap-4 min-h-0">
        <StarredTile office={office} onOpenJob={openJob} />
        {/* req 8: the single Team activity feed, reverse-chron status
            changes, comments, logged attempts, and snoozes across the
            office. Replaces the old personal "Since last login" feed; the
            center owner-only "team" slot above is cut so this is the only
            Team activity surface left. */}
        <ActivityTile scope="office" title="Team activity" filter={TEAM_ACTIVITY_FILTER}
          jobsById={jobsById} onOpenJob={openJob} />
      </div>
      </div>

      {selectedJob && (
        <JobDetailsModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          job={selectedJob}
          activeTab={modalTab}
          onActiveTabChange={setModalTab}
          onEditJob={() => { /* Today is read-first; edit reuses worklist flow if needed */ }}
          commentsDefaultOverdue={modalOverdue}
        />
      )}

      {editState && (
        <TileEditDialog
          open
          onOpenChange={(o) => { if (!o) setEditState(null); }}
          kind={editState.kind}
          slotIndex={editState.slotIndex}
          config={config}
          customStatuses={customStatuses}
          role={user?.role ?? "staff"}
          onSave={onSaveConfig}
        />
      )}
    </div>
  );
}
