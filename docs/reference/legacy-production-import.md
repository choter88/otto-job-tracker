# Legacy production import notes (archived)

This repo previously included `PRODUCTION_IMPORT_INSTRUCTIONS.md` / `.txt` intended for a hosted/Replit production environment and for migrating data from Supabase/Lovable.

For the offline/desktop track, those docs are intentionally de-emphasized because:
- importing/exporting production data is a high-risk area for accidental ePHI leakage
- the new target architecture is per-office local storage (Host/SOT) with controlled backup/restore

If you still need the legacy import workflow for a one-time migration, recover it from Git history and rework it into a dedicated, access-controlled migration tool (ideally separate from the main app repo).

