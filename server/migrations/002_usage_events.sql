-- Usage events table for anonymous product analytics (no PHI)
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  office_id TEXT,
  event_type TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS usage_events_created_at_idx ON usage_events (created_at);
CREATE INDEX IF NOT EXISTS usage_events_event_type_created_at_idx ON usage_events (event_type, created_at);
