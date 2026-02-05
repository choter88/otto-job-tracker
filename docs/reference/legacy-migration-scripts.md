# Legacy migration scripts (removed)

This repo previously contained ad-hoc scripts used to import/export production data during the hosted/Replit era (Python/TypeScript scripts that referenced `attached_assets/` exports).

Those scripts were removed as part of the desktop/offline effort because they increase the risk of accidental ePHI leakage via:
- committed CSV/SQL dumps
- developer-run exports on production datasets

If you need a one-time migration path from the hosted app to an office-local Host/SOT instance, implement it as a dedicated, access-controlled migration tool (ideally a separate repo) with explicit redaction and audit logging.

