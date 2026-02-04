#!/usr/bin/env python3
"""
Supabase to Replit Data Migration Script
Generates SQL INSERT statements from Supabase CSV exports
"""
import csv
import json
import sys
from datetime import datetime

# Temporary password for all users (they'll need to reset)
# Hash for "TempPass123!" in {hash}.{salt} format expected by Replit auth system
TEMP_PASSWORD = "689d290e41d29a7d10245431f107e93bb5ab4d8848b431ce79335294b050bf0b3f8f636b4bb09119e24bbaa6bd3ff72cc2884fa9ff3b257978befa05ec67880e.bcaecd7cbdb86297f26cdd368af6209d"

def escape_sql_string(value):
    """Escape a string for SQL insertion"""
    if value is None or value == '':
        return 'NULL'
    # Replace single quotes with two single quotes for SQL escaping
    escaped = value.replace("'", "''")
    return f"'{escaped}'"

def format_value(value, is_jsonb=False, is_timestamp=False):
    """Format a value for SQL insertion"""
    if value is None or value == '':
        return 'NULL'
    
    if is_jsonb:
        # Parse and re-serialize to ensure valid JSON
        try:
            # The CSV contains escaped JSON strings
            json_obj = json.loads(value)
            json_str = json.dumps(json_obj)
            return f"'{json_str}'::jsonb"
        except:
            return 'NULL'
    
    if is_timestamp:
        # Timestamps are already in proper format
        return f"'{value}'"
    
    return escape_sql_string(value)

def read_csv_file(filename):
    """Read a CSV file and return rows as dictionaries"""
    rows = []
    with open(filename, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

def generate_offices_insert(rows):
    """Generate INSERT statements for offices"""
    statements = []
    statements.append("\n-- Import Offices")
    
    for row in rows:
        cols = []
        vals = []
        
        for col in ['id', 'name', 'address', 'phone', 'email', 'created_at', 'updated_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=(col in ['created_at', 'updated_at'])))
        
        # Handle settings JSONB
        if row.get('settings'):
            cols.append('settings')
            vals.append(format_value(row['settings'], is_jsonb=True))
        
        # Always add enabled=true
        cols.append('enabled')
        vals.append('true')
        
        stmt = f"INSERT INTO offices ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_users_insert(rows):
    """Generate INSERT statements for users (from profiles)"""
    statements = []
    statements.append("\n-- Import Users (from profiles)")
    statements.append(f"-- NOTE: All users have temporary password 'TempPass123!' and must reset on first login")
    
    for row in rows:
        cols = ['id', 'email', 'password', 'role']
        vals = [
            format_value(row['id']),
            format_value(row['email']),
            format_value(TEMP_PASSWORD),
            format_value(row['role'])
        ]
        
        # Handle optional first_name and last_name (super_admin has empty values)
        if row.get('first_name'):
            cols.append('first_name')
            vals.append(format_value(row['first_name']))
        else:
            cols.append('first_name')
            vals.append("'Unknown'")
        
        if row.get('last_name'):
            cols.append('last_name')
            vals.append(format_value(row['last_name']))
        else:
            cols.append('last_name')
            vals.append("'User'")
        
        # Handle optional office_id (super_admin has no office)
        if row.get('office_id'):
            cols.append('office_id')
            vals.append(format_value(row['office_id']))
        
        # Timestamps
        for col in ['created_at', 'updated_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=True))
        
        stmt = f"INSERT INTO users ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_jobs_insert(rows, active_job_ids):
    """Generate INSERT statements for jobs"""
    statements = []
    statements.append("\n-- Import Jobs (sorted: originals first, then redos)")
    
    # Sort jobs: jobs without original_job_id first, then jobs with original_job_id
    # This ensures originals are inserted before their redos
    sorted_rows = sorted(rows, key=lambda r: (
        bool(r.get('original_job_id') and r['original_job_id'] in active_job_ids), 
        r.get('id', '')
    ))
    
    counter = 1
    for row in sorted_rows:
        cols = []
        vals = []
        
        # Handle each required field individually
        cols.append('id')
        vals.append(format_value(row['id']))
        
        cols.append('patient_first_initial')
        vals.append(format_value(row['patient_first_initial']))
        
        cols.append('patient_last_name')
        vals.append(format_value(row['patient_last_name']))
        
        cols.append('job_type')
        vals.append(format_value(row['job_type']))
        
        cols.append('status')
        vals.append(format_value(row['status']))
        
        # Handle order_destination - use "Unknown" if missing
        cols.append('order_destination')
        if row.get('order_destination'):
            vals.append(format_value(row['order_destination']))
        else:
            vals.append("'Unknown'")
        
        cols.append('office_id')
        vals.append(format_value(row['office_id']))
        
        # Handle order_id - generate if missing
        cols.append('order_id')
        if row.get('order_id'):
            vals.append(format_value(row['order_id']))
        else:
            vals.append(f"'MIGRATED-{counter:04d}'")
            counter += 1
        
        # Optional fields
        for col in ['phone', 'created_by', 'notes', 'assigned_to']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col]))
        
        # Handle original_job_id - only include if original job is still active
        # Set to NULL if original is archived or doesn't exist
        if row.get('original_job_id'):
            if row['original_job_id'] in active_job_ids:
                cols.append('original_job_id')
                vals.append(format_value(row['original_job_id']))
            # else: skip it (NULL) - original is archived or doesn't exist
        
        # Timestamps
        for col in ['created_at', 'updated_at', 'status_changed_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=True))
        
        # Boolean fields
        if row.get('is_redo_job'):
            cols.append('is_redo_job')
            vals.append('true' if row['is_redo_job'] == 'true' else 'false')
        
        # JSONB fields
        if row.get('custom_column_values'):
            cols.append('custom_column_values')
            vals.append(format_value(row['custom_column_values'], is_jsonb=True))
        
        stmt = f"INSERT INTO jobs ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_archived_jobs_insert(rows):
    """Generate INSERT statements for archived_jobs"""
    statements = []
    statements.append("\n-- Import Archived Jobs")
    
    counter = 1
    for row in rows:
        cols = []
        vals = []
        
        # Handle each required field individually
        cols.append('id')
        vals.append(format_value(row['id']))
        
        cols.append('patient_first_initial')
        vals.append(format_value(row['patient_first_initial']))
        
        cols.append('patient_last_name')
        vals.append(format_value(row['patient_last_name']))
        
        cols.append('job_type')
        vals.append(format_value(row['job_type']))
        
        # Handle order_destination - use "Unknown" if missing
        cols.append('order_destination')
        if row.get('order_destination'):
            vals.append(format_value(row['order_destination']))
        else:
            vals.append("'Unknown'")
        
        cols.append('office_id')
        vals.append(format_value(row['office_id']))
        
        # Map status -> final_status for archived jobs (use "Unknown" if missing)
        cols.append('final_status')
        if row.get('status'):
            vals.append(format_value(row['status']))
        else:
            vals.append("'Unknown'")
        
        # Handle order_id - generate if missing
        cols.append('order_id')
        if row.get('order_id'):
            vals.append(format_value(row['order_id']))
        else:
            vals.append(f"'ARCHIVED-{counter:04d}'")
            counter += 1
        
        # Optional fields
        for col in ['phone', 'created_by', 'notes', 'assigned_to', 'previous_status', 'original_job_id']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col]))
        
        # Timestamps
        for col in ['archived_at', 'completed_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=True))
        
        # Map created_at -> original_created_at for archived jobs
        if row.get('created_at'):
            cols.append('original_created_at')
            vals.append(format_value(row['created_at'], is_timestamp=True))
        
        # Boolean fields
        if row.get('is_redo_job'):
            cols.append('is_redo_job')
            vals.append('true' if row['is_redo_job'] == 'true' else 'false')
        
        # JSONB fields
        if row.get('custom_column_values'):
            cols.append('custom_column_values')
            vals.append(format_value(row['custom_column_values'], is_jsonb=True))
        
        stmt = f"INSERT INTO archived_jobs ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_comments_insert(rows, active_job_ids):
    """Generate INSERT statements for job_comments (only for active jobs)"""
    statements = []
    statements.append("\n-- Import Job Comments (only for active jobs)")
    
    for row in rows:
        # Skip comments for archived jobs
        if row['job_id'] not in active_job_ids:
            continue
        cols = ['id', 'job_id', 'author_id', 'content']
        vals = [
            format_value(row['id']),
            format_value(row['job_id']),
            format_value(row['user_id']),  # user_id maps to author_id
            format_value(row['comment'])   # comment maps to content
        ]
        
        # Timestamps
        for col in ['created_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=True))
        
        stmt = f"INSERT INTO job_comments ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_status_history_insert(rows, active_job_ids):
    """Generate INSERT statements for job_status_history (only for active jobs)"""
    statements = []
    statements.append("\n-- Import Job Status History (only for active jobs)")
    
    for row in rows:
        # Skip history for archived jobs
        if row['job_id'] not in active_job_ids:
            continue
        cols = ['id', 'job_id', 'new_status', 'changed_by']
        vals = [
            format_value(row['id']),
            format_value(row['job_id']),
            format_value(row['new_status']),
            format_value(row['changed_by'])
        ]
        
        # Optional old_status
        if row.get('old_status'):
            cols.append('old_status')
            vals.append(format_value(row['old_status']))
        
        # Timestamp
        if row.get('changed_at'):
            cols.append('changed_at')
            vals.append(format_value(row['changed_at'], is_timestamp=True))
        
        stmt = f"INSERT INTO job_status_history ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def generate_notification_rules_insert(rows):
    """Generate INSERT statements for notification_rules"""
    statements = []
    statements.append("\n-- Import Notification Rules")
    
    for row in rows:
        cols = ['id', 'office_id', 'status', 'max_days']
        vals = [
            format_value(row['id']),
            format_value(row['office_id']),
            format_value(row['status']),
            row['max_days']  # Integer, no escaping needed
        ]
        
        # Boolean fields
        enabled = row.get('enabled', 'true')
        cols.append('enabled')
        vals.append('true' if enabled == 'true' else 'false')
        
        sms_enabled = row.get('sms_enabled', 'false')
        cols.append('sms_enabled')
        vals.append('true' if sms_enabled == 'true' else 'false')
        
        # Optional SMS template
        if row.get('sms_template'):
            cols.append('sms_template')
            vals.append(format_value(row['sms_template']))
        
        # JSONB arrays
        for col in ['notify_roles', 'notify_users']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_jsonb=True))
        
        # Timestamps
        for col in ['created_at']:
            if row.get(col):
                cols.append(col)
                vals.append(format_value(row[col], is_timestamp=True))
        
        stmt = f"INSERT INTO notification_rules ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        statements.append(stmt)
    
    return statements

def main():
    print("-- Supabase to Replit Data Migration SQL Script")
    print("-- Generated:", datetime.now().isoformat())
    print("-- WARNING: This will import production data from Supabase")
    print()
    print("BEGIN;")
    print()
    
    # Import in dependency order
    print(f"-- 1. Import {len(read_csv_file('attached_assets/offices_rows_1760830134264.csv'))} Offices")
    offices = read_csv_file('attached_assets/offices_rows_1760830134264.csv')
    for stmt in generate_offices_insert(offices):
        print(stmt)
    
    print(f"\n-- 2. Import {len(read_csv_file('attached_assets/profiles_rows_1760830134264.csv'))} Users")
    users = read_csv_file('attached_assets/profiles_rows_1760830134264.csv')
    for stmt in generate_users_insert(users):
        print(stmt)
    
    print(f"\n-- 3. Import {len(read_csv_file('attached_assets/jobs_rows_1760830134264.csv')) - 1} Jobs")
    jobs = read_csv_file('attached_assets/jobs_rows_1760830134264.csv')
    active_job_ids_temp = {row['id'] for row in jobs}
    for stmt in generate_jobs_insert(jobs, active_job_ids_temp):
        print(stmt)
    
    print(f"\n-- 4. Import Archived Jobs")
    archived_jobs = read_csv_file('attached_assets/archived_jobs_rows_1760830134264.csv')
    for stmt in generate_archived_jobs_insert(archived_jobs):
        print(stmt)
    
    # Get active job IDs for filtering
    jobs = read_csv_file('attached_assets/jobs_rows_1760830134264.csv')
    active_job_ids = {row['id'] for row in jobs}
    
    print(f"\n-- 5. Import Job Comments (filtered to active jobs only)")
    comments = read_csv_file('attached_assets/job_comments_rows_1760830134264.csv')
    for stmt in generate_comments_insert(comments, active_job_ids):
        print(stmt)
    
    print(f"\n-- 6. Import Status History (filtered to active jobs only)")
    history = read_csv_file('attached_assets/job_status_history_rows_1760830134264.csv')
    for stmt in generate_status_history_insert(history, active_job_ids):
        print(stmt)
    
    print(f"\n-- 7. Import {len(read_csv_file('attached_assets/notification_rules_rows_1760830134264.csv')) - 1} Notification Rules")
    rules = read_csv_file('attached_assets/notification_rules_rows_1760830134264.csv')
    for stmt in generate_notification_rules_insert(rules):
        print(stmt)
    
    print()
    print("COMMIT;")
    print()
    print("-- Migration complete!")
    print("-- Next steps:")
    print("-- 1. All users must reset their passwords (temporary password: TempPass123!)")
    print("-- 2. Verify data integrity by checking row counts")
    print("-- 3. Test application functionality")

if __name__ == '__main__':
    main()
