-- Order-sheet folder automation.
--
-- 1) jobs.source / archived_jobs.source — how a job entered Otto.
--    NULL = created by hand; 'order_sheet' = created by the order-sheet
--    watcher. Existing rows stay NULL (they were all manual).
ALTER TABLE jobs ADD COLUMN source TEXT;
ALTER TABLE archived_jobs ADD COLUMN source TEXT;

-- 2) Ledger of every order-sheet file the automation has seen. The
--    (office_id, content_hash) unique index is the dedup guarantee: the
--    same file bytes are never imported twice, across restarts, renames,
--    or multiple watching computers.
CREATE TABLE IF NOT EXISTS order_sheet_imports (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices(id),
  file_name TEXT NOT NULL,
  source_path TEXT,
  device_label TEXT,
  content_hash TEXT NOT NULL,
  file_size INTEGER,
  -- imported | needs_review | failed | dismissed
  status TEXT NOT NULL,
  -- JSON: { fields: {...}, missing: [...] } from the shared parser.
  -- Extracted fields only — never the full sheet text (PHI minimization).
  parsed TEXT,
  failure_reason TEXT,
  -- Soft link to the created job (no FK: archiving moves jobs out of the
  -- jobs table and the ledger must keep its history).
  job_id TEXT,
  job_order_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  processed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS order_sheet_imports_office_hash_unique
  ON order_sheet_imports (office_id, content_hash);

CREATE INDEX IF NOT EXISTS order_sheet_imports_office_created_idx
  ON order_sheet_imports (office_id, created_at);
