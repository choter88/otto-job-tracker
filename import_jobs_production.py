#!/usr/bin/env python3
"""
Import job-related data from Lovable/Supabase CSVs into production database.
This script clears existing job data and imports fresh data from CSV files.

Tables imported:
- jobs (active jobs)
- archived_jobs (completed jobs)
- job_status_history (status change audit trail)
- job_comments (comments on jobs)
- notifications (overdue job notifications)

WARNING: This script will DELETE existing job data from your database.

Usage:
    python import_jobs_production.py --confirm PRODUCTION

Prerequisites:
    pip install psycopg2-binary python-dotenv
"""

import csv
import os
import sys
import argparse
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_batch
import subprocess

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set")
    sys.exit(1)

def connect_db():
    """Connect to PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False  # Use transactions
        return conn
    except Exception as e:
        print(f"ERROR: Failed to connect to database: {e}")
        sys.exit(1)

def create_backup(cursor):
    """Create backup of tables before deletion."""
    print("\n=== CREATING BACKUP ===")
    
    tables = ['jobs', 'archived_jobs', 'job_comments', 'job_status_history', 'notifications', 'job_flags']
    backup_file = f"backup_jobs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
    
    try:
        # Create backup using pg_dump for specific tables
        backup_cmd = [
            'pg_dump',
            DATABASE_URL,
            '--table=jobs',
            '--table=archived_jobs',
            '--table=job_comments',
            '--table=job_status_history',
            '--table=notifications',
            '--table=job_flags',
            '--data-only',
            '--inserts',
            '-f', backup_file
        ]
        
        subprocess.run(backup_cmd, check=True, capture_output=True)
        print(f"✓ Backup created: {backup_file}")
        print(f"  To restore: psql $DATABASE_URL -f {backup_file}")
        return backup_file
    except subprocess.CalledProcessError as e:
        print(f"WARNING: Backup failed: {e}")
        print("Proceeding without backup. Press Ctrl+C to cancel or Enter to continue...")
        input()
        return None

def count_records(cursor):
    """Count records in each table before deletion."""
    print("\n=== CURRENT DATA COUNT ===")
    
    tables = ['jobs', 'archived_jobs', 'job_comments', 'job_status_history', 'notifications', 'job_flags']
    counts = {}
    
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        counts[table] = count
        print(f"  {table}: {count} rows")
    
    return counts

def clear_existing_data(cursor):
    """Clear existing job-related data from all tables."""
    print("\n=== CLEARING EXISTING JOB DATA ===")
    print("⚠️  WARNING: This will permanently delete all job data!")
    print("Press Ctrl+C to cancel or Enter to continue...")
    input()
    
    tables_to_clear = [
        'notifications',          # Depends on jobs
        'job_status_history',     # Depends on jobs
        'job_comments',           # Depends on jobs
        'job_flags',              # Depends on jobs (Important Jobs feature - WILL BE LOST)
        'archived_jobs',          # Independent
        'jobs'                    # Parent table
    ]
    
    for table in tables_to_clear:
        cursor.execute(f"DELETE FROM {table}")
        deleted = cursor.rowcount
        print(f"✓ Deleted {deleted} rows from {table}")

def import_jobs(cursor):
    """Import active jobs from CSV."""
    print("\n=== IMPORTING ACTIVE JOBS ===")
    
    csv_file = 'attached_assets/jobs_rows-2_1762722093046.csv'
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        
        for row in reader:
            # Handle NULL/empty values
            rows.append((
                row['id'],
                row['office_id'],
                row['patient_first_initial'],
                row['patient_last_name'],
                row['phone'] or None,
                row['job_type'],
                row['status'],
                row['notes'] or None,
                row['created_at'],
                row['updated_at'],
                row['created_by'] or None,
                row['assigned_to'] or None,
                row['status_changed_at'] or None,
                row['order_destination'] or None,
                row['is_redo_job'].lower() == 'true' if row['is_redo_job'] else False,
                row['original_job_id'] or None,
                row['custom_column_values'] or '{}',
                row['order_id'] or None
            ))
    
    insert_query = """
        INSERT INTO jobs (
            id, office_id, patient_first_initial, patient_last_name, phone,
            job_type, status, notes, created_at, updated_at, created_by,
            assigned_to, status_changed_at, order_destination, is_redo_job,
            original_job_id, custom_column_values, order_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
    """
    
    execute_batch(cursor, insert_query, rows)
    print(f"✓ Imported {len(rows)} active jobs")
    return len(rows)

def import_archived_jobs(cursor):
    """Import archived (completed) jobs from CSV."""
    print("\n=== IMPORTING ARCHIVED JOBS ===")
    
    csv_file = 'attached_assets/archived_jobs_rows-2_1762722093046.csv'
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        
        for row in reader:
            # Handle NULL/empty values
            rows.append((
                row['id'],
                row['office_id'],
                row['patient_first_initial'],
                row['patient_last_name'],
                row['phone'] or None,
                row['job_type'],
                row['status'],
                row['notes'] or None,
                row['created_at'],
                row['updated_at'],
                row['created_by'] or None,
                row['assigned_to'] or None,
                row['status_changed_at'] or None,
                row['order_destination'] or None,
                row['archived_at'],
                row['archived_by'] or None,
                row['archive_reason'] or None,
                row['is_redo_job'].lower() == 'true' if row['is_redo_job'] else False,
                row['original_job_id'] or None,
                row['custom_column_values'] or '{}',
                row['order_id'] or None
            ))
    
    insert_query = """
        INSERT INTO archived_jobs (
            id, office_id, patient_first_initial, patient_last_name, phone,
            job_type, status, notes, created_at, updated_at, created_by,
            assigned_to, status_changed_at, order_destination, archived_at,
            archived_by, archive_reason, is_redo_job, original_job_id,
            custom_column_values, order_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
    """
    
    execute_batch(cursor, insert_query, rows)
    print(f"✓ Imported {len(rows)} archived jobs")
    return len(rows)

def import_job_comments(cursor):
    """Import job comments from CSV."""
    print("\n=== IMPORTING JOB COMMENTS ===")
    
    csv_file = 'attached_assets/job_comments_rows-2_1762722093046.csv'
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        
        for row in reader:
            rows.append((
                row['id'],
                row['job_id'],
                row['user_id'],
                row['comment'],
                row['created_at'],
                row['updated_at']
            ))
    
    insert_query = """
        INSERT INTO job_comments (
            id, job_id, user_id, comment, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s
        )
    """
    
    execute_batch(cursor, insert_query, rows)
    print(f"✓ Imported {len(rows)} job comments")
    return len(rows)

def import_job_status_history(cursor):
    """Import job status history from CSV."""
    print("\n=== IMPORTING JOB STATUS HISTORY ===")
    
    csv_file = 'attached_assets/job_status_history_rows-2_1762722093046.csv'
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        
        for row in reader:
            rows.append((
                row['id'],
                row['job_id'],
                row['old_status'] or None,
                row['new_status'],
                row['changed_by'] or None,
                row['changed_at'],
                row['notes'] or None
            ))
    
    insert_query = """
        INSERT INTO job_status_history (
            id, job_id, old_status, new_status, changed_by, changed_at, notes
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s
        )
    """
    
    execute_batch(cursor, insert_query, rows)
    print(f"✓ Imported {len(rows)} status history records")
    return len(rows)

def import_notifications(cursor):
    """Import notifications from CSV."""
    print("\n=== IMPORTING NOTIFICATIONS ===")
    
    csv_file = 'attached_assets/notifications_rows_1762722093045.csv'
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        
        for row in reader:
            rows.append((
                row['id'],
                row['office_id'],
                row['job_id'] or None,
                row['type'],
                row['title'],
                row['message'],
                row['severity'],
                row['read'].lower() == 'true' if row['read'] else False,
                row['created_at'],
                row['read_at'] or None,
                row['metadata'] or '{}'
            ))
    
    insert_query = """
        INSERT INTO notifications (
            id, office_id, job_id, type, title, message, severity, read,
            created_at, read_at, metadata
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
    """
    
    execute_batch(cursor, insert_query, rows)
    print(f"✓ Imported {len(rows)} notifications")
    return len(rows)

def main():
    """Main import function."""
    parser = argparse.ArgumentParser(description='Import production job data from CSV files')
    parser.add_argument('--confirm', type=str, required=True,
                       help='Type "PRODUCTION" to confirm you want to run this on production')
    parser.add_argument('--skip-backup', action='store_true',
                       help='Skip backup creation (not recommended)')
    
    args = parser.parse_args()
    
    if args.confirm != 'PRODUCTION':
        print("ERROR: You must pass --confirm PRODUCTION to run this script")
        print("Example: python import_jobs_production.py --confirm PRODUCTION")
        sys.exit(1)
    
    print("=" * 60)
    print("OTTO TRACKER - PRODUCTION DATA IMPORT")
    print("=" * 60)
    print(f"\n⚠️  WARNING: This will DELETE all existing job data!")
    print(f"Database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'unknown'}")
    print(f"\nStarted at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    conn = connect_db()
    cursor = conn.cursor()
    
    backup_file = None
    
    try:
        # Show current counts
        old_counts = count_records(cursor)
        
        # Create backup (unless skipped)
        if not args.skip_backup:
            backup_file = create_backup(cursor)
        
        # Clear existing data (with confirmation prompt)
        clear_existing_data(cursor)
        
        # Import all data
        jobs_count = import_jobs(cursor)
        archived_count = import_archived_jobs(cursor)
        comments_count = import_job_comments(cursor)
        history_count = import_job_status_history(cursor)
        notifications_count = import_notifications(cursor)
        
        # Commit transaction
        conn.commit()
        
        # Summary
        print("\n" + "=" * 60)
        print("IMPORT COMPLETED SUCCESSFULLY")
        print("=" * 60)
        print(f"\nData Replaced:")
        print(f"  Active Jobs:        {old_counts['jobs']} → {jobs_count}")
        print(f"  Archived Jobs:      {old_counts['archived_jobs']} → {archived_count}")
        print(f"  Comments:           {old_counts['job_comments']} → {comments_count}")
        print(f"  Status History:     {old_counts['job_status_history']} → {history_count}")
        print(f"  Notifications:      {old_counts['notifications']} → {notifications_count}")
        print(f"  Job Flags (LOST):   {old_counts['job_flags']} → 0")
        
        if backup_file:
            print(f"\n💾 Backup file: {backup_file}")
            print(f"   To restore: psql $DATABASE_URL -f {backup_file}")
        
        print(f"\nCompleted at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("\n✓ All data imported successfully!")
        
    except Exception as e:
        conn.rollback()
        print(f"\n✗ ERROR during import: {e}")
        print("\nTransaction rolled back. No changes were made to the database.")
        if backup_file:
            print(f"Backup file preserved: {backup_file}")
        sys.exit(1)
        
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    main()
