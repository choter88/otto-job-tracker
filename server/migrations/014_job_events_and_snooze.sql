-- Today v2 data foundation: order-event envelope + jobs snooze columns.
--
-- job_events is an append-only table, one row per staff action on a job.
-- Keyed by the stable ORD-… handle (job_order_id), NOT jobs.id, so events
-- survive archive (same precedent as job_attachments / order_sheet_imports).
-- job_id is a best-effort snapshot of the current jobs.id and is NOT a
-- foreign key.
--
-- NOTE: the guarded bootstrap helper (ensureSnoozeColumns in
-- server/sqlite-bootstrap.ts) is the real upgrade path for the jobs snooze
-- columns on existing installs — it runs before this migration (bootstrap's
-- statements[] + ensure*() helpers run, THEN runMigrations()) and already
-- adds snoozed_until/snooze_reason via ALTER TABLE ... ADD COLUMN guarded by
-- hasColumn(). SQLite has no `ADD COLUMN IF NOT EXISTS`, so this migration
-- deliberately does NOT repeat those ALTER TABLE statements — doing so would
-- throw "duplicate column name" on every boot once bootstrap has already
-- added them, which would never get marked applied and would crash startup
-- forever. This file is belt-and-suspenders for job_events only: its CREATE
-- TABLE / CREATE INDEX statements are idempotent no-ops if bootstrap ran
-- first.
CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_order_id TEXT NOT NULL,
  job_id TEXT,
  office_id TEXT NOT NULL REFERENCES offices(id),
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  actor_initials TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS job_events_order_idx ON job_events (job_order_id);
CREATE INDEX IF NOT EXISTS job_events_office_created_idx ON job_events (office_id, created_at);
CREATE INDEX IF NOT EXISTS job_events_office_type_idx ON job_events (office_id, event_type);
