# Repository data cleanup (PHI/PII risk)

This repo previously contained SQL/CSV exports with patient last names and phone numbers. Those files were removed from the working tree, but **Git history may still contain them**.

## Recommended next steps

1. **Purge sensitive files from Git history** (example using `git filter-repo`):
   - Remove any `prod_*.sql`, `production_import.sql`, `migration_import.sql`, and any `attached_assets/*_rows*.csv`
2. **Rotate any credentials** that may have been present in exports, logs, or `.env` files.
3. **Confirm current `.gitignore` rules** prevent re-adding exports/logs.

If you want, I can help you run `git filter-repo` safely (it rewrites history and requires coordination with anyone who has cloned the repo).

