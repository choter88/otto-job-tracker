-- Order-sheet watcher presence: one row per computer running the folder
-- automation, refreshed by a ~60s heartbeat from that machine's renderer.
-- Powers the office-wide "Watching from" panel on the Order Sheets page
-- so any computer can see which machines are watching, which folder, and
-- when each was last heard from. Telemetry only — ingest never reads it.
CREATE TABLE IF NOT EXISTS order_sheet_watchers (
  -- Same per-machine id the sync websocket registers with
  -- (localStorage "otto.deviceId"); lets us join user-set device names.
  device_id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices(id),
  device_label TEXT,
  -- Display only; paths mean nothing off the owning machine.
  folder_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- watching | error | stopped
  state TEXT NOT NULL,
  error TEXT,
  last_heartbeat_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS order_sheet_watchers_office_idx
  ON order_sheet_watchers (office_id);
