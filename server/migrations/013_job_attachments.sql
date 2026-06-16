-- User-uploaded job attachments (documents staff attach to a job:
-- insurance cards, Rx scans, lab receipts, etc.). Distinct from the
-- auto-imported order sheet on order_sheet_imports — the job modal's
-- ATTACHMENTS section unions the two. Keyed by the stable ORD-… handle
-- (job_order_id), identical on active and archived rows, so an attachment
-- stays resolvable after a job is archived. Uploads are kept through
-- archive and removed only when the order is permanently deleted. The
-- file lives at <data>/job-attachments/<id>.<ext> (0600); only the
-- relative path is stored here.
CREATE TABLE IF NOT EXISTS job_attachments (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices(id),
  job_order_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  attachment_path TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS job_attachments_office_order_idx
  ON job_attachments (office_id, job_order_id);
