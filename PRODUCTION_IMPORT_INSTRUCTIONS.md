# Production Data Import Instructions

## Overview

This guide will help you import job-related data from your Lovable/Supabase database into your Replit production database.

**What will be imported:**
- 58 active jobs
- 121 archived jobs
- 40 job comments
- 1,083 status history records
- 31 notifications

**What will NOT be imported:**
- Users (already in database)
- Offices (already in database)
- Notification rules (already in database)

**⚠️ IMPORTANT WARNINGS:**

1. **This will DELETE all existing job data** from your production database
2. **Job flags will be lost** - Any jobs flagged as "Important" will need to be re-flagged
3. **This operation is IRREVERSIBLE** (unless you have a backup)
4. **Users and offices must already exist** in the target database (they do)

---

## Prerequisites

1. **Install Python dependencies:**
   ```bash
   pip install psycopg2-binary python-dotenv
   ```

2. **Verify DATABASE_URL:**
   ```bash
   echo $DATABASE_URL
   ```
   
   Make sure this points to your **production** database.

3. **Verify CSV files exist:**
   ```bash
   ls -lh attached_assets/*-2_1762722093046.csv attached_assets/notifications_rows_1762722093045.csv
   ```
   
   You should see:
   - `jobs_rows-2_1762722093046.csv` (58 rows)
   - `archived_jobs_rows-2_1762722093046.csv` (121 rows)
   - `job_comments_rows-2_1762722093046.csv` (40 rows)
   - `job_status_history_rows-2_1762722093046.csv` (1,083 rows)
   - `notifications_rows_1762722093045.csv` (31 rows)

---

## Step-by-Step Import Process

### Step 1: Access Production Database

Open the Replit Database tool from the left sidebar to access your production database.

### Step 2: Review Current Data

Check how many records you currently have:

```sql
SELECT 'jobs' as table_name, COUNT(*) as count FROM jobs
UNION ALL
SELECT 'archived_jobs', COUNT(*) FROM archived_jobs
UNION ALL
SELECT 'job_comments', COUNT(*) FROM job_comments
UNION ALL
SELECT 'job_status_history', COUNT(*) FROM job_status_history
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL
SELECT 'job_flags', COUNT(*) FROM job_flags;
```

**Write down these numbers!** You'll need them if you need to troubleshoot.

### Step 3: Run the Import Script

The script includes safety features:
- Requires `--confirm PRODUCTION` flag
- Creates automatic backup (using pg_dump)
- Shows before/after counts
- Uses database transactions (all-or-nothing)
- Prompts before deletion

**Run the import:**

```bash
python import_jobs_production.py --confirm PRODUCTION
```

The script will:
1. Show current record counts
2. Create a backup file (`backup_jobs_YYYYMMDD_HHMMSS.sql`)
3. Prompt you to confirm before deleting data
4. Delete all existing job data
5. Import new data from CSVs
6. Show summary of changes

**Example output:**
```
=== CURRENT DATA COUNT ===
  jobs: 59 rows
  archived_jobs: 48 rows
  job_comments: 12 rows
  job_status_history: 168 rows
  notifications: 0 rows
  job_flags: 1 rows

=== CREATING BACKUP ===
✓ Backup created: backup_jobs_20251109_143022.sql
  To restore: psql $DATABASE_URL -f backup_jobs_20251109_143022.sql

=== CLEARING EXISTING JOB DATA ===
⚠️  WARNING: This will permanently delete all job data!
Press Ctrl+C to cancel or Enter to continue...
```

**Press Enter to continue** or **Ctrl+C to cancel**.

### Step 4: Verify Import

After import completes, verify the data in the Replit Database tool:

```sql
-- Check job counts
SELECT COUNT(*) FROM jobs;  -- Should be 58
SELECT COUNT(*) FROM archived_jobs;  -- Should be 121

-- Check a few sample jobs
SELECT patient_first_initial, patient_last_name, job_type, status 
FROM jobs 
ORDER BY created_at DESC 
LIMIT 10;

-- Verify status history was imported
SELECT COUNT(*) FROM job_status_history;  -- Should be 1,083

-- Verify comments were imported
SELECT COUNT(*) FROM job_comments;  -- Should be 40
```

---

## Troubleshooting

### Problem: "ERROR: DATABASE_URL environment variable not set"

**Solution:**
```bash
# Check if DATABASE_URL is set
echo $DATABASE_URL

# If not set, you need to export it
export DATABASE_URL="your_database_url_here"
```

### Problem: "permission denied" or "command not found: psql"

The backup feature requires `pg_dump` to be installed. If it's not available:

**Option 1: Skip backup (not recommended)**
```bash
python import_jobs_production.py --confirm PRODUCTION --skip-backup
```

**Option 2: Manual backup before import**

In the Replit Database tool, run:
```sql
-- Export to a file manually using the Database tool's export feature
-- or use Replit's built-in database backup feature
```

### Problem: Import fails partway through

The script uses database transactions, so if it fails, **no changes will be made** to your database.

Error message will show:
```
✗ ERROR during import: [error details]
Transaction rolled back. No changes were made to the database.
```

Your database remains in its original state.

### Problem: Need to restore from backup

If you created a backup and need to restore it:

```bash
# Restore the backup file
psql $DATABASE_URL -f backup_jobs_20251109_143022.sql
```

---

## Post-Import Tasks

### 1. Re-flag Important Jobs

Since job flags are lost during import, you'll need to re-flag any important jobs:

1. Navigate to All Jobs page
2. Click the star icon on jobs you want to flag as important
3. AI summaries will be generated automatically

### 2. Verify Application Works

1. Open your application
2. Check that jobs display correctly
3. Verify status history shows up
4. Test creating a new job
5. Test commenting on jobs

---

## Data Loss Warning

**This import will permanently delete:**

✗ Job flags (Important Jobs markings)  
✗ Any jobs created after the CSV export  
✗ Any comments added after the CSV export  
✗ Any status changes after the CSV export  

**This import will preserve:**

✓ Users and their passwords  
✓ Office settings  
✓ Notification rules  
✓ SMS opt-ins  
✓ All other non-job data  

---

## Safety Checklist

Before running the import:

- [ ] I have verified DATABASE_URL points to production
- [ ] I have reviewed current data counts
- [ ] I understand that job flags will be lost
- [ ] I understand this will delete all current job data
- [ ] I have backup files or can restore from Lovable if needed
- [ ] I am ready to re-flag important jobs after import
- [ ] I have tested the import process (optional: run in development first)

---

## Questions?

If you encounter any issues during the import process, **STOP** and do not proceed. The script is designed to fail safely without making changes if there's an error.

Common safe stopping points:
- After seeing the record counts
- After backup creation
- At the deletion confirmation prompt

You can always Ctrl+C to cancel without making any changes.
