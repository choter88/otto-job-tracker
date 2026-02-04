import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

function parseCSV(filePath: string): any[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true
  });
  
  return records.map((row: any) => {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(row)) {
      cleaned[key] = (value === '' || value === null) ? null : value;
    }
    return cleaned;
  });
}

function sqlValue(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  // Escape single quotes
  const escaped = String(val).replace(/'/g, "''");
  return `'${escaped}'`;
}

function generateJobsSQL(): string[] {
  const rows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  const sql: string[] = [];
  
  const allJobIds = new Set(rows.map(r => r.id));
  const normalJobs = rows.filter(r => r.is_redo_job !== 'true');
  const redoJobs = rows.filter(r => r.is_redo_job === 'true');
  const sortedRows = [...normalJobs, ...redoJobs];
  
  for (const row of sortedRows) {
    let customColumns = '{}';
    if (row.custom_column_values && row.custom_column_values.trim() !== '') {
      try {
        const parsed = JSON.parse(row.custom_column_values);
        customColumns = JSON.stringify(parsed);
      } catch (e) {
        customColumns = '{}';
      }
    }
    
    let originalJobId = row.original_job_id;
    if (row.is_redo_job === 'true' && originalJobId && !allJobIds.has(originalJobId)) {
      originalJobId = null;
    }
    
    const orderId = row.order_id || 'ORD-' + row.id.substring(0, 8);
    
    sql.push(`INSERT INTO jobs (id, office_id, patient_first_initial, patient_last_name, phone, job_type, status, notes, created_at, updated_at, created_by, status_changed_at, order_destination, is_redo_job, original_job_id, custom_column_values, order_id) VALUES (${sqlValue(row.id)}, ${sqlValue(row.office_id)}, ${sqlValue(row.patient_first_initial)}, ${sqlValue(row.patient_last_name)}, ${sqlValue(row.phone)}, ${sqlValue(row.job_type)}, ${sqlValue(row.status)}, ${sqlValue(row.notes)}, ${sqlValue(row.created_at)}, ${sqlValue(row.updated_at)}, ${sqlValue(row.created_by)}, ${sqlValue(row.status_changed_at)}, ${sqlValue(row.order_destination)}, ${row.is_redo_job === 'true'}, ${sqlValue(originalJobId)}, ${sqlValue(customColumns)}, ${sqlValue(orderId)});`);
  }
  
  return sql;
}

function generateArchivedJobsSQL(): string[] {
  const rows = parseCSV('attached_assets/archived_jobs_rows-2_1762722093046.csv');
  const sql: string[] = [];
  
  for (const row of rows) {
    let customColumns = '{}';
    if (row.custom_column_values && row.custom_column_values.trim() !== '') {
      try {
        const parsed = JSON.parse(row.custom_column_values);
        customColumns = JSON.stringify(parsed);
      } catch (e) {
        customColumns = '{}';
      }
    }
    
    const orderId = row.order_id || 'ORD-' + row.id.substring(0, 8);
    const orderDest = row.order_destination || 'unknown';
    const originalCreatedAt = row.created_at || row.archived_at || '2025-01-01 00:00:00';
    const archivedAt = row.archived_at || '2025-01-01 00:00:00';
    
    sql.push(`INSERT INTO archived_jobs (id, office_id, patient_first_initial, patient_last_name, phone, job_type, final_status, previous_status, notes, original_created_at, created_by, order_destination, archived_at, is_redo_job, original_job_id, custom_column_values, order_id) VALUES (${sqlValue(row.id)}, ${sqlValue(row.office_id)}, ${sqlValue(row.patient_first_initial)}, ${sqlValue(row.patient_last_name)}, ${sqlValue(row.phone)}, ${sqlValue(row.job_type)}, ${sqlValue(row.status)}, ${sqlValue(row.status)}, ${sqlValue(row.notes)}, ${sqlValue(originalCreatedAt)}, ${sqlValue(row.created_by)}, ${sqlValue(orderDest)}, ${sqlValue(archivedAt)}, ${row.is_redo_job === 'true'}, ${sqlValue(row.original_job_id)}, ${sqlValue(customColumns)}, ${sqlValue(orderId)});`);
  }
  
  return sql;
}

function generateCommentsSQL(): string[] {
  const rows = parseCSV('attached_assets/job_comments_rows-2_1762722093046.csv');
  const jobRows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  const activeJobIds = new Set(jobRows.map((r: any) => r.id));
  
  const sql: string[] = [];
  
  for (const row of rows) {
    if (!activeJobIds.has(row.job_id)) continue;
    
    sql.push(`INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES (${sqlValue(row.id)}, ${sqlValue(row.job_id)}, ${sqlValue(row.user_id)}, ${sqlValue(row.comment)}, ${sqlValue(row.created_at)});`);
  }
  
  return sql;
}

function generateStatusHistorySQL(): string[] {
  const rows = parseCSV('attached_assets/job_status_history_rows-2_1762722093046.csv');
  const jobRows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  const activeJobIds = new Set(jobRows.map((r: any) => r.id));
  
  const sql: string[] = [];
  
  for (const row of rows) {
    if (!activeJobIds.has(row.job_id)) continue;
    if (!row.changed_by) continue;
    
    sql.push(`INSERT INTO job_status_history (id, job_id, old_status, new_status, changed_by, changed_at) VALUES (${sqlValue(row.id)}, ${sqlValue(row.job_id)}, ${sqlValue(row.old_status)}, ${sqlValue(row.new_status)}, ${sqlValue(row.changed_by)}, ${sqlValue(row.changed_at)});`);
  }
  
  return sql;
}

console.log('Generating production SQL import file...\n');

const output: string[] = [];

output.push('-- Otto Tracker Production Data Import');
output.push('-- Generated: ' + new Date().toISOString());
output.push('-- Run this in your PRODUCTION database\n');

output.push('-- IMPORTANT: This will DELETE all existing job data!');
output.push('-- Make sure you have a backup before running this.\n');

output.push('BEGIN;\n');

output.push('-- Step 1: Clear existing job data');
output.push('DELETE FROM notifications;');
output.push('DELETE FROM job_status_history;');
output.push('DELETE FROM job_comments;');
output.push('DELETE FROM job_flags;');
output.push('DELETE FROM archived_jobs;');
output.push('DELETE FROM jobs;\n');

output.push('-- Step 2: Import active jobs (57 rows)');
const jobsSQL = generateJobsSQL();
output.push(...jobsSQL);
output.push('');

output.push('-- Step 3: Import archived jobs (117 rows)');
const archivedSQL = generateArchivedJobsSQL();
output.push(...archivedSQL);
output.push('');

output.push('-- Step 4: Import job comments (6 rows for active jobs)');
const commentsSQL = generateCommentsSQL();
output.push(...commentsSQL);
output.push('');

output.push('-- Step 5: Import job status history (197 rows for active jobs)');
const historySQL = generateStatusHistorySQL();
output.push(...historySQL);
output.push('');

output.push('COMMIT;\n');

output.push('-- Import complete!');
output.push(`-- Active Jobs: ${jobsSQL.length}`);
output.push(`-- Archived Jobs: ${archivedSQL.length}`);
output.push(`-- Comments: ${commentsSQL.length}`);
output.push(`-- Status History: ${historySQL.length}`);

fs.writeFileSync('production_import.sql', output.join('\n'));

console.log('✓ Generated production_import.sql');
console.log(`  - ${jobsSQL.length} active jobs`);
console.log(`  - ${archivedSQL.length} archived jobs`);
console.log(`  - ${commentsSQL.length} comments`);
console.log(`  - ${historySQL.length} status history records`);
console.log('\nNext steps:');
console.log('1. Open the Replit Database tool');
console.log('2. Switch to PRODUCTION database');
console.log('3. Copy the contents of production_import.sql');
console.log('4. Paste and execute in the SQL console');
