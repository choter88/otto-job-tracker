import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

function parseCSV(filePath: string): any[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true
  });
  
  // Convert empty strings to null
  return records.map((row: any) => {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(row)) {
      cleaned[key] = (value === '' || value === null) ? null : value;
    }
    return cleaned;
  });
}

async function countRecords() {
  console.log('\n=== CURRENT DATA COUNT ===');
  
  const counts: Record<string, number> = {};
  
  for (const table of ['jobs', 'archived_jobs', 'job_comments', 'job_status_history', 'notifications', 'job_flags']) {
    const result = await sql(`SELECT COUNT(*) as count FROM ${table}`);
    counts[table] = parseInt(result[0].count);
    console.log(`  ${table}: ${counts[table]} rows`);
  }
  
  return counts;
}

async function clearExistingData() {
  console.log('\n=== CLEARING EXISTING JOB DATA ===');
  console.log('⚠️  WARNING: This will permanently delete all job data!');
  
  const tables = [
    'notifications',
    'job_status_history',
    'job_comments',
    'job_flags',
    'archived_jobs',
    'jobs'
  ];
  
  for (const table of tables) {
    await sql(`DELETE FROM ${table}`);
    console.log(`✓ Deleted all rows from ${table}`);
  }
}

async function importJobs() {
  console.log('\n=== IMPORTING ACTIVE JOBS ===');
  
  const rows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  
  // Build a set of all job IDs in the CSV for reference checking
  const allJobIds = new Set(rows.map(r => r.id));
  
  // Sort rows: non-redo jobs first, then redo jobs (to satisfy foreign key constraints)
  const normalJobs = rows.filter(r => r.is_redo_job !== 'true');
  const redoJobs = rows.filter(r => r.is_redo_job === 'true');
  const sortedRows = [...normalJobs, ...redoJobs];
  
  for (const row of sortedRows) {
    // Parse custom column values properly
    let customColumns = '{}';
    if (row.custom_column_values && row.custom_column_values.trim() !== '') {
      try {
        // The CSV has double-escaped JSON, so we need to parse it
        const parsed = JSON.parse(row.custom_column_values);
        customColumns = JSON.stringify(parsed);
      } catch (e) {
        customColumns = '{}';
      }
    }
    
    // If this is a redo job and the original_job_id doesn't exist in active jobs,
    // set it to NULL (the original job was likely archived)
    let originalJobId = row.original_job_id;
    if (row.is_redo_job === 'true' && originalJobId && !allJobIds.has(originalJobId)) {
      console.log(`  Warning: Job ${row.id} references archived original job ${originalJobId}, setting to NULL`);
      originalJobId = null;
    }
    
    await sql`
      INSERT INTO jobs (
        id, office_id, patient_first_initial, patient_last_name, phone,
        job_type, status, notes, created_at, updated_at, created_by,
        status_changed_at, order_destination, is_redo_job,
        original_job_id, custom_column_values, order_id
      ) VALUES (
        ${row.id},
        ${row.office_id},
        ${row.patient_first_initial},
        ${row.patient_last_name},
        ${row.phone},
        ${row.job_type},
        ${row.status},
        ${row.notes},
        ${row.created_at},
        ${row.updated_at},
        ${row.created_by},
        ${row.status_changed_at},
        ${row.order_destination},
        ${row.is_redo_job === 'true'},
        ${originalJobId},
        ${customColumns},
        ${row.order_id || 'ORD-' + row.id.substring(0, 8)}
      )
    `;
  }
  
  console.log(`✓ Imported ${rows.length} active jobs`);
  return rows.length;
}

async function importArchivedJobs() {
  console.log('\n=== IMPORTING ARCHIVED JOBS ===');
  
  const rows = parseCSV('attached_assets/archived_jobs_rows-2_1762722093046.csv');
  
  for (const row of rows) {
    // Parse custom column values properly
    let customColumns = '{}';
    if (row.custom_column_values && row.custom_column_values.trim() !== '') {
      try {
        // The CSV has double-escaped JSON, so we need to parse it
        const parsed = JSON.parse(row.custom_column_values);
        customColumns = JSON.stringify(parsed);
      } catch (e) {
        customColumns = '{}';
      }
    }
    
    await sql`
      INSERT INTO archived_jobs (
        id, office_id, patient_first_initial, patient_last_name, phone,
        job_type, final_status, previous_status, notes, original_created_at, created_by,
        order_destination, archived_at, is_redo_job, original_job_id,
        custom_column_values, order_id
      ) VALUES (
        ${row.id},
        ${row.office_id},
        ${row.patient_first_initial},
        ${row.patient_last_name},
        ${row.phone},
        ${row.job_type},
        ${row.status},
        ${row.status},
        ${row.notes},
        ${row.created_at || row.archived_at || '2025-01-01 00:00:00'},
        ${row.created_by},
        ${row.order_destination || 'unknown'},
        ${row.archived_at || '2025-01-01 00:00:00'},
        ${row.is_redo_job === 'true'},
        ${row.original_job_id},
        ${customColumns},
        ${row.order_id || 'ORD-' + row.id.substring(0, 8)}
      )
    `;
  }
  
  console.log(`✓ Imported ${rows.length} archived jobs`);
  return rows.length;
}

async function importJobComments() {
  console.log('\n=== IMPORTING JOB COMMENTS ===');
  
  const rows = parseCSV('attached_assets/job_comments_rows-2_1762722093046.csv');
  
  // Get list of active job IDs
  const jobRows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  const activeJobIds = new Set(jobRows.map((r: any) => r.id));
  
  let imported = 0;
  let skipped = 0;
  
  for (const row of rows) {
    // Only import comments for active jobs (skip comments on archived jobs)
    if (!activeJobIds.has(row.job_id)) {
      skipped++;
      continue;
    }
    
    await sql`
      INSERT INTO job_comments (
        id, job_id, author_id, content, created_at
      ) VALUES (
        ${row.id},
        ${row.job_id},
        ${row.user_id},
        ${row.comment},
        ${row.created_at}
      )
    `;
    imported++;
  }
  
  console.log(`✓ Imported ${imported} job comments (${skipped} skipped - archived jobs)`);
  return imported;
}

async function importJobStatusHistory() {
  console.log('\n=== IMPORTING JOB STATUS HISTORY ===');
  
  const rows = parseCSV('attached_assets/job_status_history_rows-2_1762722093046.csv');
  
  // Get list of active job IDs
  const jobRows = parseCSV('attached_assets/jobs_rows-2_1762722093046.csv');
  const activeJobIds = new Set(jobRows.map((r: any) => r.id));
  
  let imported = 0;
  let skipped = 0;
  
  for (const row of rows) {
    // Only import status history for active jobs
    if (!activeJobIds.has(row.job_id)) {
      skipped++;
      continue;
    }
    
    // Skip if changed_by is null (required field in schema)
    if (!row.changed_by) {
      skipped++;
      continue;
    }
    
    await sql`
      INSERT INTO job_status_history (
        id, job_id, old_status, new_status, changed_by, changed_at
      ) VALUES (
        ${row.id},
        ${row.job_id},
        ${row.old_status},
        ${row.new_status},
        ${row.changed_by},
        ${row.changed_at}
      )
    `;
    imported++;
  }
  
  console.log(`✓ Imported ${imported} status history records (${skipped} skipped)`);
  return imported;
}

async function importNotifications() {
  console.log('\n=== IMPORTING NOTIFICATIONS ===');
  console.log('⚠️  Skipping notifications - schema mismatch between CSV and database');
  console.log('    (CSV has office_id/severity/read, DB has user_id/actor_id/type enum)');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (!args.includes('--confirm') || args[args.indexOf('--confirm') + 1] !== 'PRODUCTION') {
    console.error('ERROR: You must pass --confirm PRODUCTION to run this script');
    console.error('Example: tsx import-jobs-production.ts --confirm PRODUCTION');
    process.exit(1);
  }
  
  console.log('='.repeat(60));
  console.log('OTTO TRACKER - PRODUCTION DATA IMPORT');
  console.log('='.repeat(60));
  console.log('\n⚠️  WARNING: This will DELETE all existing job data!');
  console.log(`Started at: ${new Date().toISOString()}`);
  
  try {
    // Show current counts
    const oldCounts = await countRecords();
    
    // Clear existing data
    await clearExistingData();
    
    // Import all data
    const jobsCount = await importJobs();
    const archivedCount = await importArchivedJobs();
    const commentsCount = await importJobComments();
    const historyCount = await importJobStatusHistory();
    const notificationsCount = await importNotifications();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('IMPORT COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log('\nData Replaced:');
    console.log(`  Active Jobs:        ${oldCounts.jobs} → ${jobsCount}`);
    console.log(`  Archived Jobs:      ${oldCounts.archived_jobs} → ${archivedCount}`);
    console.log(`  Comments:           ${oldCounts.job_comments} → ${commentsCount}`);
    console.log(`  Status History:     ${oldCounts.job_status_history} → ${historyCount}`);
    console.log(`  Notifications:      ${oldCounts.notifications} → ${notificationsCount}`);
    console.log(`  Job Flags (LOST):   ${oldCounts.job_flags} → 0`);
    console.log(`\nCompleted at: ${new Date().toISOString()}`);
    console.log('\n✓ All data imported successfully!');
    
  } catch (error) {
    console.error('\n✗ ERROR during import:', error);
    console.error('\nImport failed. Database may be in inconsistent state.');
    process.exit(1);
  }
}

main();
