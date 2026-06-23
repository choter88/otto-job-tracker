import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { resolveTodayConfig } from "@shared/today-defaults";
import type { Job } from "@shared/schema";
import JobDetailsModal, { type JobDetailsTab } from "@/components/job-details-modal";
import JobQueueTile from "@/components/today/job-queue-tile";
import StarredTile from "@/components/today/starred-tile";

export default function Today() {
  const { user } = useAuth();
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: office } = useQuery<any>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

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
  // Used by Tasks 11/12 tiles that receive it as a prop.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  // Edit-popover triggers. Filled in by Task 13; declared here so tiles can
  // receive a stable handler from the first render.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const openEditFor = (_slotIndex: number) => {}; // Task 13
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const openActivityEdit = () => {}; // Task 13

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-line bg-panel">
        <h1 className="text-2xl font-semibold text-ink">Today</h1>
        <p className="text-sm text-ink-2 mt-1">
          {greeting}, {user?.firstName} — <strong>{jobs.length} jobs</strong> need a hand today.
        </p>
      </header>

      <div className="flex-1 min-h-0 flex gap-4 p-6 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto flex flex-col gap-5">
          {/* Task 8/9/13: render config.slots[0] and config.slots[1] by type */}
          {config.slots.map((slot, i) =>
            slot.type === "queue" && (slot.mode === "outreach" || slot.mode === "chase") ? (
              <JobQueueTile key={i} slot={slot} jobs={jobs} office={office} onOpenJob={openJob} onEdit={() => openEditFor(i)} />
            ) : (
              <div key={i} data-testid={`today-slot-${i}`} />  // owner tiles filled in later tasks
            )
          )}
        </div>
        <div className="w-[360px] flex-none flex flex-col gap-4 min-h-0">
          <StarredTile office={office} onOpenJob={openJob} />
          {/* Task 12: <ActivityTile filter={config.activityFilter} onOpenJob={openJob} /> */}
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
    </div>
  );
}
