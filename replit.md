# Otto Tracker - Job Management System for Optometry Practices

## Overview

Otto Tracker is a comprehensive job/order management system for optometry practices, designed to track glasses orders (contacts, prescriptions, sunglasses, etc.) through their complete lifecycle. Key capabilities include role-based access control, real-time notifications, SMS/email integration, and analytics. The system aims to streamline job management from creation to completion or pickup.

## Recent Changes (October 2025)

**Data Migration from Lovable/Supabase (COMPLETED):**
- Successfully migrated production data from Supabase to Replit PostgreSQL
- Imported 4 offices, 5 users, 58 active jobs, 44 archived jobs, 12 comments, 168 status history records, and 8 notification rules
- Schema adapted: Converted job_type and status from enums to varchar(50) to support office-specific custom values
- Made phone and created_by fields nullable in jobs/archived_jobs tables for legacy data compatibility
- Preserved all custom statuses (status_1758832364028, status_1758929953866, status_1759026641002) and JSONB office settings
- Created Python migration script (import_supabase_data.py) for repeatable imports with edge case handling
- All users have temporary password "TempPass123!" and must reset on first login
- Migration artifacts retained in repo: import_supabase_data.py, migration_import.sql, CSV files in attached_assets/

**UI/UX Improvements:**
- Jobs table search now filters by patient name only (first initial + last name) with "Search patients" placeholder
- All destination badges now display colored backgrounds correctly (fixed ID/label matching logic)
- Edit Job modal properly pre-populates all form fields with existing job data
- Comment indicators show count badges: grey circle with number (turns red for unread comments)
- Invite functionality fixed: displays invite link in modal with copy button and manual fallback (resolves clipboard permission errors)
- Added column sorting for Patient (by last name), Job Type, Status, and Destination
- Removed Order ID and Phone columns from main table view, added Last Updated column
- Search field relocated next to New Job button, Sort/Filter buttons removed

**Latest Updates:**
- Fixed invite link 404 error: Complete invitation acceptance flow with public verify endpoint, registration flow, and AcceptInvite page
- Status position restrictions enhanced: Job Created always stays first, Completed always stays last (post-move validation prevents edge cases)
- Notification rules now save instantly: Added optimistic updates to all mutations for immediate UI feedback with automatic rollback on errors
- Custom job types/statuses/destinations now fully supported: Removed hardcoded enum validation from both frontend AND backend to accept any office-specific custom values (e.g., "rx", "status_1758832364028")
  - Frontend: JobDialog form validation uses z.string() instead of z.enum()
  - Backend: insertJobSchema explicitly overrides jobType and status with z.string() validation
  - Both create and update operations now work with custom values
- Destination display fixed: Badges now show proper labels (e.g., "Zeiss Surfacing") instead of IDs (e.g., "destination_1758834102413")
- Job edit form now saves destination IDs consistently instead of mixing IDs and labels

**Important Jobs Feature (November 2025):**
- Users can flag jobs as important using star button in jobs table with optimistic UI updates
- Important Jobs page is now the default landing page (/) showing flagged jobs with AI-generated summaries
- AI summary service analyzes job data, status history, and comments to provide contextual insights
- Each job card displays expanded comments view for better context
- Star button shows filled yellow star for flagged jobs, outline for unflagged
- Sidebar shows "Important" nav item with badge count of flagged jobs
- OpenAI integration configured via Replit AI Integrations (billed to credits, no API key required)
- Backend endpoints: POST/DELETE /api/jobs/:jobId/flag, GET /api/jobs/flagged, POST /api/jobs/:jobId/summary
- Database: Added job_flags table with unique constraint on (user_id, job_id)

**Cost Optimization (December 2025):**
- NOTIFICATION SYSTEM DISABLED to reduce compute credits usage
- WebSocket connections for real-time notifications turned off (was keeping server active continuously)
- Background scheduled jobs disabled (overdue detection at midnight, analytics aggregation at 1 AM)
- To re-enable: uncomment code in server/index.ts and client/src/components/notification-bell.tsx

**Security Fix (December 2025):**
- Fixed cross-session data leakage where new users could see cached job data from previous sessions
- Root cause: React Query cache persisted between login/logout cycles, showing stale data to new users
- Fix: Added queryClient.clear() in onMutate handlers for login, register, and logout mutations
- Cache is now purged immediately when auth actions begin (not after network response) to prevent any stale data exposure

**Error Logging (December 2025):**
- Added file-based error logging to /tmp/error_log.json (no external costs)
- Captures all 4xx/5xx API responses with: timestamp, method, path, status, error message, userId, officeId, duration
- Rotates to keep last 1000 entries to prevent disk bloat
- Request bodies are deep-sanitized to redact passwords/tokens/secrets
- Admin endpoints: GET /api/admin/errors, GET /api/admin/errors/stats, DELETE /api/admin/errors

**Tray Number Feature (December 2025):**
- Added configurable job identifier modes: offices can choose between patient name (default) or tray number
- Job Identifier Mode setting in Office Settings > General tab with dropdown selector
- Patient Name mode (default): Jobs identified by first initial + last name (e.g., "J. Smith")
- Tray Number mode: Jobs identified by manually-entered tray number, patient name fields not required
- Schema: Added trayNumber field (varchar 50) to jobs and archived_jobs tables
- Frontend: JobDialog conditionally shows tray number or patient name fields based on office setting
- Jobs table: Column header changes to "Tray #", search filters by tray number, placeholder updates
- Backend: Server-side validation enforces tray number required when in tray mode
- Duplicate tray number prevention: Backend returns 409 error if tray number already exists; frontend shows alert modal
- Setting stored in office.settings.jobIdentifierMode ("patientName" or "trayNumber")

**HIPAA Compliance Features (December 2025):**
- PHI Access Audit Logging: All access to patient data is logged to phi_access_logs table including user, action, entity, IP address, and timestamp
- Session Timeout: 15-minute inactivity timeout with rolling sessions (activity extends session), frontend warning 2 minutes before expiry
- Password Complexity: Minimum 12 characters, requires uppercase, lowercase, number, and special character; validated on both frontend and backend

**Bug Fixes (December 2025):**
- Notification rules now support custom statuses: Changed validation from hardcoded enum to accept any office-configured status
- Past Jobs destination display: Now shows friendly labels instead of IDs (matches All Jobs table behavior)
- Order ID generation: Fixed duplicate orderId errors by querying max from both jobs AND archived_jobs tables, using numeric ordering (not string), and adding retry loop for concurrent creation

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Tooling:** React 18.3.1 with TypeScript, Vite, React Router (Wouter), and path aliases.
**UI Component System:** Radix UI primitives, Tailwind CSS with CSS variables for theming, and Shadcn/ui (New York variant) with custom color scheme and light/dark mode.
**State Management & Data Fetching:** TanStack Query v5 for server state, React Context API for auth and settings, and React Hook Form with Zod validation.
**Key Design Patterns:** Protected routes, centralized API handling with error boundaries, optimistic updates, and toast notifications.

### Backend Architecture

**Server Framework:** Express.js with TypeScript, Passport.js for session-based authentication, scrypt for password hashing, and connect-pg-simple for session storage in PostgreSQL.
**API Design:** RESTful API endpoints, authentication middleware, and role-based authorization (owner, manager, staff, view_only, super_admin).

### Data Storage Architecture

**Database:** PostgreSQL (via Neon Serverless) with Drizzle ORM for type-safe queries and drizzle-kit for migrations.
**Core Data Models:**
- `users`: User accounts with roles and office links.
- `offices`: Practice locations with settings.
- `jobs`, `archived_jobs`: Active and historical job records with status tracking.
- `job_comments`, `job_status_history`: Audit trails for jobs.
- `notification_rules`, `notifications`: Configurable alerts and in-app notifications.
- `admin_audit_logs`: Platform-wide admin action audit.
- `sms_opt_ins`, `sms_logs`: SMS consent and delivery tracking.
**Schema Design Principles:** UUID primary keys, timestamps, JSONB for flexible data, foreign key relationships, and varchar for extensible value sets (job_type and status support office-specific custom values).
**Status Workflow:** Jobs progress through `job_created` → `ordered` → `in_progress` → `quality_check` → `ready_for_pickup` → `completed` or `cancelled`.

### Real-Time Features

**WebSocket Integration:** Express-integrated WebSocket server for real-time updates with session-based authentication and multi-tab support.
**Notification System:** Supports status change, comment, overdue, and mention notification types, delivered via WebSockets with in-app display and mark-as-read functionality.

### Admin Portal

**Super Admin Features:** Platform statistics, office and user management, and admin audit logging.
**Admin Security:** Super admin role required for `/api/admin/*` endpoints, `requireAdmin` middleware, and audit logging of all admin actions.

### Analytics Dashboard

**Metrics & KPIs:** Active Jobs, Completion Rate, Average Completion Time, and Jobs Completed.
**Visualizations:** Status Distribution pie chart, Job Type Breakdown bar chart, and Completion Trends line chart.
**Filtering:** Date range and job type filtering with server-side aggregation.

### Custom Columns System

Enables user-defined fields (text, number, date, checkbox) for jobs per office, configurable via settings, displayed, filterable, and sortable in the JobsTable. Custom column definitions are stored in `offices.settings.customColumns` (JSONB), and values in `jobs.customColumnValues` (JSONB).

### Scheduled Background Jobs

**Overdue Detection Job:** Runs daily to identify overdue jobs based on notification rules, creating in-app and SMS notifications.
**Analytics Aggregation Job:** Runs daily to aggregate per-office and platform-wide job metrics into `job_analytics` and `platform_analytics` tables.
**Implementation:** Uses `node-cron` for scheduling, starting automatically on server boot, with comprehensive error logging.

### Security Considerations

**Authentication Security:** Scrypt password hashing, timing-safe comparison, and secure session-based cookies.
**Authorization Model:** Role hierarchy with office-scoped data access.
**Data Validation:** Zod schemas for runtime validation on all inputs, client-side and server-side validation.

## External Dependencies

**SMS Integration:** Twilio (via Replit Connectors API) for job notifications and reminders, with opt-in/opt-out consent tracking.
**Database:** Neon PostgreSQL (serverless with connection pooling).
**Session Management:** PostgreSQL session store (`connect-pg-simple`).
**Email Integration:** Planned but not yet configured.