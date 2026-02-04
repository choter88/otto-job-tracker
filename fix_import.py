import csv

# Read active job IDs
active_jobs = set()
with open('attached_assets/jobs_rows_1760830134264.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        active_jobs.add(row['id'])

# Read archived job IDs for reference
archived_jobs = set()
with open('attached_assets/archived_jobs_rows_1760830134264.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        archived_jobs.add(row['id'])

# Filter comments - only keep those for active jobs
comments = []
skipped_count = 0
with open('attached_assets/job_comments_rows_1760830134264.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['job_id'] in active_jobs:
            comments.append(row)
        else:
            skipped_count += 1

# Filter status history - only keep those for active jobs
history = []
skipped_history = 0
with open('attached_assets/job_status_history_rows_1760830134264.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['job_id'] in active_jobs:
            history.append(row)
        else:
            skipped_history += 1

print(f"Active jobs: {len(active_jobs)}")
print(f"Archived jobs: {len(archived_jobs)}")
print(f"Comments for active jobs: {len(comments)}")
print(f"Comments skipped (archived): {skipped_count}")
print(f"History for active jobs: {len(history)}")
print(f"History skipped (archived): {skipped_history}")
