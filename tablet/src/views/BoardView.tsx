import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { updateJobStatus, ApiError, queueMutation } from "../api";
import { TopBar } from "../components/TopBar";
import { StatusTabs } from "../components/StatusTabs";
import { CardGrid } from "../components/CardGrid";
import type { TabletUser, OfficeConfig, Job, NotificationRule } from "../types";

interface BoardViewProps {
  user: TabletUser;
  config: OfficeConfig;
  jobs: Job[];
  commentCounts: Record<string, number>;
  notificationRules: NotificationRule[];
  activeTab: string;
  page: number;
  onTabChange: (tab: string) => void;
  onPageChange: (page: number) => void;
  onJobSelect: (id: string) => void;
  onNewJob: () => void;
  onLogout: () => void;
  onDataChanged: () => void;
}

export function BoardView({
  user,
  config,
  jobs,
  commentCounts,
  notificationRules,
  activeTab,
  page,
  onTabChange,
  onPageChange,
  onJobSelect,
  onNewJob,
  onLogout,
  onDataChanged,
}: BoardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // Apply optimistic status updates to jobs
  const effectiveJobs = useMemo(() => {
    return jobs.map((j) => {
      const override = optimisticUpdates[j.id];
      return override ? { ...j, status: override } : j;
    });
  }, [jobs, optimisticUpdates]);

  // Filter by active tab + search
  const filteredJobs = useMemo(() => {
    let result = effectiveJobs.filter((j) => j.status === activeTab);
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((j) => {
        const name = `${j.patientLastName} ${j.patientFirstName}`.toLowerCase();
        const tray = (j.trayNumber || "").toLowerCase();
        return name.includes(q) || tray.includes(q);
      });
    }
    return result;
  }, [effectiveJobs, activeTab, debouncedQuery]);

  const handleAdvance = useCallback(
    async (jobId: string, nextStatus: string) => {
      // Optimistic update
      setOptimisticUpdates((prev) => ({ ...prev, [jobId]: nextStatus }));

      try {
        await updateJobStatus(jobId, nextStatus);
        onDataChanged();
      } catch (err) {
        // Revert optimistic update
        setOptimisticUpdates((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });

        if (err instanceof ApiError && err.status === 0) {
          // Network error — queue for retry
          queueMutation(() => updateJobStatus(jobId, nextStatus));
        }
      }
    },
    [onDataChanged],
  );

  return (
    <>
      <TopBar
        user={user}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewJob={onNewJob}
        onLogout={onLogout}
      />
      <StatusTabs
        statuses={config.customStatuses}
        jobs={effectiveJobs}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />
      <CardGrid
        jobs={filteredJobs}
        config={config}
        commentCounts={commentCounts}
        notificationRules={notificationRules}
        page={page}
        onPageChange={onPageChange}
        onJobSelect={onJobSelect}
        onAdvance={handleAdvance}
      />
    </>
  );
}
