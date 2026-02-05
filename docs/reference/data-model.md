# Data model (high level)

Core tables (see `shared/schema.ts` for the authoritative schema):

- `offices`: practice locations and per-office `settings` (JSON)
- `users`: login identities, role, optional `office_id`
- `jobs`: active job/order records (patient initials/last name, destination, type, status, custom columns)
- `archived_jobs`: completed/cancelled historical jobs
- `job_status_history`: immutable status transitions per job (who/when)
- `job_comments`: comments per job
- `comment_reads`: per-user “last read” marker per job
- `job_flags`: per-user “important” flag + optional summary text

Operational/supporting tables:

- `join_requests`: request to join an office
- `invitations`: invite users to an office with token/expiry
- `notification_rules`: per-office overdue/status rules
- `notifications`: in-app notifications
- `sms_opt_ins`, `sms_logs`: consent + delivery logs
- `admin_audit_logs`: platform admin actions
- `job_analytics`, `platform_analytics`: aggregated metrics
- `phi_access_logs`: access events for HIPAA auditability

