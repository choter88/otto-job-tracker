-- Add a `source` column to usage_events so the portal can break out tablet
-- activity from desktop activity. Existing rows backfill to 'app' (anything
-- pre-migration came from the desktop UI). New writes from /api/track stay
-- 'app' by default; /tablet/api/track explicitly writes 'tablet'.
ALTER TABLE usage_events ADD COLUMN source TEXT NOT NULL DEFAULT 'app';

CREATE INDEX IF NOT EXISTS usage_events_source_created_at_idx
  ON usage_events (source, created_at);
