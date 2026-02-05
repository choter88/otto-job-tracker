# Feature inventory (current app)

## Auth & users
- Session-based auth (Passport Local)
- Registration supports invite tokens
- Password complexity enforcement
- Automatic logout on inactivity (15 minutes)
- Roles: `owner`, `manager`, `staff`, `view_only`, `super_admin`

## Offices
- Office record with configurable `settings` (custom statuses, job types, destinations, custom columns, SMS templates, etc.)
- Office enable/disable (platform/admin oriented)

## Jobs
- Create/update/delete jobs
- Job identifier modes (patient name vs tray number) with duplicate tray number checks
- Status workflow with history (`job_status_history`)
- Terminal status handling: archive on `completed`/`cancelled`
- Archived jobs list + restore to active

## Comments & collaboration
- Job comments with unread tracking (`comment_reads`)
- Comment counts and unread indicators

## “Important jobs”
- Users can flag jobs as important (`job_flags`)
- Optional AI-generated summaries (currently OpenAI-based; should be disabled by default for HIPAA/offline)

## Notifications
- Notification rules + notifications table exist
- WebSocket broadcast code exists but may be disabled in `server/index.ts`

## Audit logging
- Admin audit logs (`admin_audit_logs`)
- PHI access logs (`phi_access_logs`) used in key API routes (expand coverage as needed)

## SMS
- SMS opt-in flow + logs exist
- SMS delivery requires external provider (Twilio); recommended disabled for HIPAA/offline by default

