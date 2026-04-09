import "../styles/board.css";
import type { StatusConfig, Job } from "../types";

interface StatusTabsProps {
  statuses: StatusConfig[];
  jobs: Job[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function StatusTabs({ statuses, jobs, activeTab, onTabChange }: StatusTabsProps) {
  const sorted = [...statuses]
    .filter((s) => s.id !== "completed" && s.id !== "cancelled")
    .sort((a, b) => a.order - b.order);

  return (
    <div className="status-tabs">
      {sorted.map((status) => {
        const count = jobs.filter((j) => j.status === status.id).length;
        const isActive = activeTab === status.id;
        return (
          <button
            key={status.id}
            className={`status-tab ${isActive ? "active" : ""}`}
            style={isActive ? { backgroundColor: status.color } : undefined}
            onClick={() => onTabChange(status.id)}
            type="button"
          >
            {status.label}
            <span className="status-tab-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
