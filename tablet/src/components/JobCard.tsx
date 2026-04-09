import "../styles/job-card.css";
import type { Job, StatusConfig, JobTypeConfig, DestinationConfig, NotificationRule } from "../types";

interface JobCardProps {
  job: Job;
  statuses: StatusConfig[];
  jobTypes: JobTypeConfig[];
  destinations: DestinationConfig[];
  commentCount: number;
  notificationRules: NotificationRule[];
  onSelect: () => void;
  onAdvance: (e: React.MouseEvent) => void;
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

function getAgeClass(job: Job, rules: NotificationRule[]): string {
  const statusAge = Date.now() - new Date(job.statusChangedAt).getTime();
  const statusAgeDays = statusAge / (1000 * 60 * 60 * 24);

  // Check notification rules for this status
  const rule = rules.find((r) => r.status === job.status && r.enabled);

  // Use rule-based thresholds if available
  if (rule) {
    if (statusAgeDays >= rule.maxDays) return "age-alert";
    if (statusAgeDays >= rule.maxDays * 0.6) return "age-warning";
    return "";
  }

  // Default thresholds
  const isReadyForPickup = job.status === "ready_for_pickup";
  const warningDays = isReadyForPickup ? 1 : 2;
  const alertDays = isReadyForPickup ? 3 : 5;

  if (statusAgeDays >= alertDays) return "age-alert";
  if (statusAgeDays >= warningDays) return "age-warning";
  return "";
}

function isOverdue(job: Job, rules: NotificationRule[]): boolean {
  const rule = rules.find((r) => r.status === job.status && r.enabled);
  if (!rule) return false;
  const statusAge = Date.now() - new Date(job.statusChangedAt).getTime();
  return statusAge / (1000 * 60 * 60 * 24) >= rule.maxDays;
}

export function JobCard({
  job,
  statuses,
  jobTypes,
  destinations,
  commentCount,
  notificationRules: rules,
  onSelect,
  onAdvance,
}: JobCardProps) {
  const sorted = [...statuses]
    .filter((s) => s.id !== "cancelled")
    .sort((a, b) => a.order - b.order);
  const currentIdx = sorted.findIndex((s) => s.id === job.status);
  const nextStatus = currentIdx >= 0 && currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;
  const isLast = currentIdx === sorted.length - 1;

  const jobType = jobTypes.find((t) => t.id === job.jobType);
  const destination = destinations.find((d) => d.id === job.orderDestination);
  const ageMs = Date.now() - new Date(job.statusChangedAt).getTime();
  const ageClass = getAgeClass(job, rules);

  const patientName = job.patientLastName && job.patientFirstName
    ? `${job.patientLastName}, ${job.patientFirstName}`
    : job.trayNumber || job.orderId;

  return (
    <div className={`job-card ${ageClass}`} onClick={onSelect}>
      <div className="job-card-header">
        <span className="job-card-patient">{patientName}</span>
        <div className="job-card-badges">
          {isOverdue(job, rules) && <span className="badge badge-overdue">OVERDUE</span>}
          {job.isRedoJob && <span className="badge badge-redo">REDO</span>}
        </div>
      </div>

      <div className="job-card-meta">
        {jobType && (
          <span className="job-type-pill" style={{ backgroundColor: jobType.color }}>
            {jobType.label}
          </span>
        )}
        {destination && <span className="job-card-destination">{destination.label}</span>}
      </div>

      <div className="job-card-footer">
        <span className="job-card-age">{formatAge(ageMs)}</span>
        {commentCount > 0 && (
          <span className="job-card-comments">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12a1 1 0 011 1v8a1 1 0 01-1 1H6l-3 3V12H2a1 1 0 01-1-1V3a1 1 0 011-1z"/></svg>
            {commentCount}
          </span>
        )}
        <span className="job-card-spacer" />
        {(nextStatus || isLast) && (
          <button
            className={`advance-btn ${isLast ? "dispense" : ""}`}
            onClick={(e) => { e.stopPropagation(); onAdvance(e); }}
            type="button"
          >
            {isLast ? "Dispense \u2713" : `${nextStatus!.label} \u2192`}
          </button>
        )}
      </div>
    </div>
  );
}
