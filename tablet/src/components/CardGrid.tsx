import "../styles/board.css";
import type { Job, OfficeConfig, NotificationRule } from "../types";
import { JobCard } from "./JobCard";

interface CardGridProps {
  jobs: Job[];
  config: OfficeConfig;
  commentCounts: Record<string, number>;
  notificationRules: NotificationRule[];
  page: number;
  onPageChange: (page: number) => void;
  onJobSelect: (id: string) => void;
  onAdvance: (jobId: string, nextStatus: string) => void;
}

function getPageSize(): number {
  // Landscape: 4 cols x 3 rows = 12, Portrait: 3 cols x 3 rows = 9
  const isLandscape = window.innerWidth > window.innerHeight;
  return isLandscape ? 12 : 9;
}

export function CardGrid({
  jobs,
  config,
  commentCounts,
  notificationRules,
  page,
  onPageChange,
  onJobSelect,
  onAdvance,
}: CardGridProps) {
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageJobs = jobs.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const sorted = [...config.customStatuses]
    .filter((s) => s.id !== "cancelled")
    .sort((a, b) => a.order - b.order);

  const getNextStatus = (currentStatus: string): string | null => {
    const idx = sorted.findIndex((s) => s.id === currentStatus);
    if (idx >= 0 && idx < sorted.length - 1) return sorted[idx + 1].id;
    if (idx === sorted.length - 1) return "completed";
    return null;
  };

  if (jobs.length === 0) {
    return <div className="board-empty">No jobs in this status</div>;
  }

  return (
    <div className="board-content">
      <div className="card-grid">
        {pageJobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            statuses={config.customStatuses}
            jobTypes={config.customJobTypes}
            destinations={config.customOrderDestinations}
            commentCount={commentCounts[job.id] || 0}
            notificationRules={notificationRules}
            onSelect={() => onJobSelect(job.id)}
            onAdvance={() => {
              const next = getNextStatus(job.status);
              if (next) onAdvance(job.id, next);
            }}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
            type="button"
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {safePage + 1} of {totalPages}
          </span>
          <button
            className="pagination-btn"
            disabled={safePage >= totalPages - 1}
            onClick={() => onPageChange(safePage + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
