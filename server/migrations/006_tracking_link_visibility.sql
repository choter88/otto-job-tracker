-- Per-link visibility config. Restores the office's ability to choose
-- which canonical patient-status enum values each tracking link emits
-- events for. Stored locally — the portal sees ONLY the events the
-- desktop chooses to emit. Hidden statuses are filtered at the
-- portal-call site (portalAppendTrackingEvent).
--
-- Keyed on the portal's opaque link token (the durable identifier this
-- host sees on every link). One row per (link_token, status_enum) pair
-- where visibility = 1. Absence of a row means hidden.

CREATE TABLE IF NOT EXISTS tracking_link_visibility_local (
  link_token TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (link_token, status)
);

CREATE INDEX IF NOT EXISTS tracking_link_visibility_local_token_idx
  ON tracking_link_visibility_local (link_token);
