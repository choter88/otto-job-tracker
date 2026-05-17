-- Patient-tracking notes live exclusively on the desktop now. Previously
-- the desktop PHI-scanned each note and POSTed it to otto-web, which
-- stored and rendered it on the patient page. The new privacy model
-- keeps notes off the portal entirely: staff still writes them in the
-- worklist UX, but they never leave the host.
--
-- Schema: per-link append-only log keyed on the portal's link token
-- (we don't mirror the portal's link UUID locally — the token is the
-- stable, durable identifier the host knows).

CREATE TABLE IF NOT EXISTS tracking_link_notes_local (
  id TEXT PRIMARY KEY,
  -- Portal token (base64url string ~22 chars). Lookup key from the UI.
  link_token TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_link_notes_local_token_created_idx
  ON tracking_link_notes_local (link_token, created_at);
