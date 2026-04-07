-- Client device registry: tracks which computers connect as clients
-- Used for over-limit enforcement and client self-disconnect
CREATE TABLE IF NOT EXISTS "client_devices" (
  "id" text PRIMARY KEY,
  "office_id" text,
  "label" text,
  "first_seen_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
  "last_seen_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
  "blocked" integer NOT NULL DEFAULT 0
);
