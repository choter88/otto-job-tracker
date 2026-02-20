# Otto Job Tracker

React (Vite) + Express + Drizzle/SQLite app for tracking optometry office jobs/orders (create/update jobs, comments, archived jobs, office settings, role-based access, and audit logging).

## Development

1. Copy env template:
   - `cp .env.example .env`
2. Set `OTTO_SQLITE_PATH` (or `OTTO_DATA_DIR`) and `SESSION_SECRET`.
3. Run:
   - `npm install`
   - `npm run dev`

## Safety / HIPAA note

This tool may handle ePHI. Do not commit patient data exports (SQL/CSV), logs, or credentials to Git. See:
- `docs/security/hipaa.md`
- `docs/security/repo-data-cleanup.md`

File-based request audit logs are written to `$OTTO_DATA_DIR/audit_log.jsonl` (override with `OTTO_AUDIT_LOG_PATH`) and are automatically pruned by retention days and max file size.

## Desktop/offline conversion

See `docs/desktop/README.md` for the recommended offline “single source of truth” (SOT) desktop architecture and a phased migration plan.
