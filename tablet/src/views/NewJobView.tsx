import { useState } from "react";
import { createJob } from "../api";
import type { OfficeConfig } from "../types";
import "../styles/new-job.css";

interface NewJobViewProps {
  config: OfficeConfig;
  onBack: () => void;
  onCreated: () => void;
}

export function NewJobView({ config, onBack, onCreated }: NewJobViewProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [trayNumber, setTrayNumber] = useState("");
  const [jobType, setJobType] = useState(config.customJobTypes[0]?.id || "");
  const [status, setStatus] = useState(() => {
    const sorted = [...config.customStatuses]
      .filter((s) => s.id !== "cancelled" && s.id !== "completed")
      .sort((a, b) => a.order - b.order);
    return sorted[0]?.id || "job_created";
  });
  const [destination, setDestination] = useState(config.customOrderDestinations[0]?.id || "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isTrayMode = config.jobIdentifierMode === "trayNumber";

  const handleSubmit = async () => {
    setError("");
    if (!isTrayMode && (!firstName.trim() || !lastName.trim())) {
      setError("Patient name is required");
      return;
    }
    if (isTrayMode && !trayNumber.trim()) {
      setError("Tray number is required");
      return;
    }
    if (!jobType) { setError("Job type is required"); return; }
    if (!destination) { setError("Destination is required"); return; }

    setSaving(true);
    try {
      await createJob({
        patientFirstName: isTrayMode ? "" : firstName.trim(),
        patientLastName: isTrayMode ? "" : lastName.trim(),
        trayNumber: trayNumber.trim() || undefined,
        jobType,
        status,
        orderDestination: destination,
        notes: notes.trim() || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message || "Failed to create job");
      setSaving(false);
    }
  };

  const sortedStatuses = [...config.customStatuses]
    .filter((s) => s.id !== "cancelled" && s.id !== "completed")
    .sort((a, b) => a.order - b.order);

  return (
    <div className="new-job">
      <div className="new-job-header">
        <button className="new-job-back" onClick={onBack} type="button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 12L6 8l4-4" /></svg>
          Cancel
        </button>
        <h1 className="new-job-title">New Job</h1>
      </div>

      <div className="new-job-body">
        <div className="new-job-form">
          {!isTrayMode && (
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">First Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="form-field">
                <label className="form-label">Last Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {isTrayMode && (
            <div className="form-field">
              <label className="form-label">Tray Number</label>
              <input
                className="form-input"
                type="text"
                value={trayNumber}
                onChange={(e) => setTrayNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {!isTrayMode && (
            <div className="form-field">
              <label className="form-label">Tray Number (Optional)</label>
              <input
                className="form-input"
                type="text"
                value={trayNumber}
                onChange={(e) => setTrayNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Job Type</label>
              <select className="form-select" value={jobType} onChange={(e) => setJobType(e.target.value)}>
                {config.customJobTypes.sort((a, b) => a.order - b.order).map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Destination</label>
              <select className="form-select" value={destination} onChange={(e) => setDestination(e.target.value)}>
                {config.customOrderDestinations.sort((a, b) => a.order - b.order).map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {sortedStatuses.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Notes (Optional)</label>
            <textarea
              className="form-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button className="form-btn secondary" onClick={onBack} disabled={saving} type="button">Cancel</button>
            <button className="form-btn primary" onClick={handleSubmit} disabled={saving} type="button">
              {saving ? "Creating..." : "Create Job"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
