import { useState, useEffect, useCallback } from "react";
import { fetchJob, updateJobStatus, addJobNote, trackEvent } from "../api";
import type { OfficeConfig, Job, JobComment, StatusHistoryEntry } from "../types";
import "../styles/job-detail.css";

interface JobDetailViewProps {
  jobId: string;
  config: OfficeConfig;
  onBack: () => void;
  onDataChanged: () => void;
}

function formatTimestamp(ts: string | number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function JobDetailView({ jobId, config, onBack, onDataChanged }: JobDetailViewProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [comments, setComments] = useState<JobComment[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [linkedJobs, setLinkedJobs] = useState<Job[]>([]);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const data = await fetchJob(jobId);
      setJob(data.job);
      setComments(data.comments);
      setStatusHistory(data.statusHistory);
      setLinkedJobs(data.linkedJobs);
    } catch {
      // Will show empty state
    }
  }, [jobId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (!job) {
    return (
      <div className="job-detail">
        <div className="job-detail-header">
          <button className="job-detail-back" onClick={onBack} type="button">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 12L6 8l4-4" /></svg>
            Back
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--otto-text-muted)" }}>
          Loading...
        </div>
      </div>
    );
  }

  const sorted = [...config.customStatuses]
    .filter((s) => s.id !== "cancelled")
    .sort((a, b) => a.order - b.order);
  const currentIdx = sorted.findIndex((s) => s.id === job.status);
  const prevStatus = currentIdx > 0 ? sorted[currentIdx - 1] : null;
  const nextStatus = currentIdx >= 0 && currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;
  const isLast = currentIdx === sorted.length - 1;
  const currentStatusConfig = config.customStatuses.find((s) => s.id === job.status);
  const jobTypeConfig = config.customJobTypes.find((t) => t.id === job.jobType);
  const destConfig = config.customOrderDestinations.find((d) => d.id === job.orderDestination);

  const patientName = job.patientLastName && job.patientFirstName
    ? `${job.patientLastName}, ${job.patientFirstName}`
    : job.trayNumber || "";

  const handleStatusChange = async (newStatus: string) => {
    setSaving(true);
    try {
      await updateJobStatus(jobId, newStatus);
      // Track only after the mutation succeeds — failed status changes
      // shouldn't show up in the portal as activity.
      trackEvent("tablet_status_changed", { from: "jobDetail", to: newStatus });
      onDataChanged();
      if (newStatus === "completed" || newStatus === "cancelled") {
        onBack();
      } else {
        await loadDetail();
      }
    } catch {
      // Ignore
    }
    setSaving(false);
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);
    try {
      await addJobNote(jobId, noteText.trim());
      setNoteText("");
      onDataChanged();
      await loadDetail();
    } catch {
      // Ignore
    }
    setSaving(false);
  };

  return (
    <div className="job-detail">
      <div className="job-detail-header">
        <button className="job-detail-back" onClick={onBack} type="button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 12L6 8l4-4" /></svg>
          Back
        </button>
        <div style={{ flex: 1 }}>
          <div className="job-detail-title">{patientName}</div>
          {job.trayNumber && (
            <div className="job-detail-order-id">Tray {job.trayNumber}</div>
          )}
        </div>
        {job.isRedoJob && <span className="badge badge-redo" style={{ fontSize: "0.75rem", padding: "4px 8px" }}>REDO</span>}
      </div>

      <div className="job-detail-body">
        <div className="job-detail-info">
          <div className="job-detail-card">
            <h3>Job Details</h3>
            {patientName && (
              <div className="detail-field">
                <span className="detail-field-label">Patient</span>
                <span className="detail-field-value">{patientName}</span>
              </div>
            )}
            {job.trayNumber && (
              <div className="detail-field">
                <span className="detail-field-label">Tray #</span>
                <span className="detail-field-value">{job.trayNumber}</span>
              </div>
            )}
            <div className="detail-field">
              <span className="detail-field-label">Status</span>
              <span className="detail-field-value" style={{ color: currentStatusConfig?.color }}>
                {currentStatusConfig?.label || job.status}
              </span>
            </div>
            <div className="detail-field">
              <span className="detail-field-label">Job Type</span>
              <span className="detail-field-value" style={{ color: jobTypeConfig?.color }}>
                {jobTypeConfig?.label || job.jobType}
              </span>
            </div>
            <div className="detail-field">
              <span className="detail-field-label">Destination</span>
              <span className="detail-field-value">{destConfig?.label || job.orderDestination}</span>
            </div>
            {job.phone && (
              <div className="detail-field">
                <span className="detail-field-label">Phone</span>
                <span className="detail-field-value">{job.phone}</span>
              </div>
            )}
            {job.notes && (
              <div className="detail-field">
                <span className="detail-field-label">Notes</span>
                <span className="detail-field-value">{job.notes}</span>
              </div>
            )}
          </div>

          <div className="status-actions">
            {prevStatus && (
              <button
                className="status-action-btn backward"
                onClick={() => handleStatusChange(prevStatus.id)}
                disabled={saving}
                type="button"
              >
                &larr; {prevStatus.label}
              </button>
            )}
            {nextStatus && (
              <button
                className="status-action-btn forward"
                onClick={() => handleStatusChange(nextStatus.id)}
                disabled={saving}
                type="button"
              >
                {nextStatus.label} &rarr;
              </button>
            )}
            {isLast && (
              <button
                className="status-action-btn dispense"
                onClick={() => handleStatusChange("completed")}
                disabled={saving}
                type="button"
              >
                Dispense &#10003;
              </button>
            )}
          </div>

          {linkedJobs.length > 0 && (
            <div className="job-detail-card">
              <h3>Linked Jobs</h3>
              {linkedJobs.map((lj) => (
                <div key={lj.id} className="linked-job-item">
                  <span>{lj.patientLastName}, {lj.patientFirstName}</span>
                  {lj.trayNumber && (
                    <span style={{ color: "var(--otto-text-muted)", fontSize: "0.75rem" }}>
                      Tray {lj.trayNumber}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="job-detail-notes">
          <div className="job-detail-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3>Notes ({comments.length})</h3>
            <div className="notes-list">
              {comments.length === 0 && (
                <p style={{ color: "var(--otto-text-muted)", fontSize: "0.8125rem" }}>No notes yet</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="note-item">
                  <span className="note-author">
                    {c.author?.firstName} {c.author?.lastName}
                    <span className="note-time">{formatTimestamp(c.createdAt)}</span>
                  </span>
                  <p className="note-content">{c.content}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="note-input-row">
            <input
              className="note-input"
              type="text"
              placeholder="Add a note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
            />
            <button
              className="note-submit-btn"
              onClick={handleAddNote}
              disabled={!noteText.trim() || saving}
              type="button"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
