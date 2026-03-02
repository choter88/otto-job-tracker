# Otto Job Tracker Handoff (for Claude Code)

Last updated: March 2, 2026

## 1) What this app is now

Otto is no longer primarily a generic web SaaS app. The current direction is a desktop-first, office-LAN deployment:

- One **Host** computer runs the API and stores the SQLite database.
- Multiple **Client** computers connect to the Host over the local network.
- Core job workflow is local-first and can operate without cloud dependencies.
- Internet should be limited to licensing check-ins (no PHI payloads).

Why this matters: most implementation choices now optimize for in-office reliability, recoverability, and low support burden for non-technical staff.

## 2) Current state at a glance

Implemented and active:

- Host/Client setup flow in Electron (`desktop/setup.html`, `desktop/main.js`).
- Host claim/activation setup flow with claim-code fallback logic.
- Local auth with Login ID + password and PIN login.
- Host-approved account request onboarding (replaced staff-code signup flow).
- Core job lifecycle: create, update, comments, flagging, archive/restore, redo.
- Important notes (human-authored) on flagged jobs.
- In-app notifications and unread counts.
- Client offline outbox (encrypted at rest in Electron userData).
- Host+Client sync invalidation via `/sync-ws` websocket.
- Daily local backup + optional network backup flows from Host menu.
- Licensing state with read-only enforcement when inactive/out of grace.
- Airgap and LAN-only guardrails enabled by default in desktop mode.

Still present but mostly legacy/web-era surface area:

- Invitation routes and join-request routes.
- Super admin routes/pages.
- SMS send route and Twilio plumbing.
- AI summary service.
- Some unused client pages/components from older web app routing.

## 3) Architecture map

### Electron layer

Main process: [`desktop/main.js`](./desktop/main.js)

Responsibilities:

- Host/client setup window + main app window lifecycle.
- Host discovery and pairing-code cert trust bootstrap.
- Host-approval polling + prompts for pending client requests.
- Offline outbox encryption/decryption and persistence (`otto-outbox.json`).
- Backup/restore menu actions and scheduled backups.
- TLS cert generation for packaged Host mode.
- Renderer network guard (blocks internet except allowed origin).
- Diagnostics and support-bundle export.

Bridge: [`desktop/preload.cjs`](./desktop/preload.cjs)

- Exposes `window.otto.*` methods to React UI.

### Backend API

Entry: [`server/index.ts`](./server/index.ts)
Routes: [`server/routes.ts`](./server/routes.ts)
Storage: [`server/storage.ts`](./server/storage.ts)
DB bootstrap: [`server/db.ts`](./server/db.ts), [`server/sqlite-bootstrap.ts`](./server/sqlite-bootstrap.ts)

Key behavior:

- Session auth with Passport local strategy.
- Role middleware and office scoping.
- License write-gate middleware for mutating `/api/*` routes.
- LAN-only request filtering (unless explicitly disabled).
- Request-level audit logging + error logging.
- Office-wide broadcast invalidation on successful mutating API calls.

### Frontend app (React)

Entry: [`client/src/App.tsx`](./client/src/App.tsx)

Current routed pages:

- `/setup`
- `/auth`
- `/`, `/dashboard/:tab?`, `/important` (redirected)

Dashboard tabs currently in use:

- Worklist (`all`)
- Important
- Past Jobs
- Overdue
- Analytics
- Team
- Settings (notification rules)

Sync/status UX:

- [`client/src/components/sync-manager.tsx`](./client/src/components/sync-manager.tsx)
- shows Host/Client mode, connection state, pending offline changes, backup status, license warnings.

## 4) Data model and migration approach

Schema source of truth:

- [`shared/schema.ts`](./shared/schema.ts)

Important pattern:

- DB is created/migrated on app start with imperative SQL + ad-hoc migrations in [`server/sqlite-bootstrap.ts`](./server/sqlite-bootstrap.ts), not a formal migration chain.
- Drizzle schema exists, but runtime compatibility relies heavily on bootstrap SQL + patch functions.

Snapshot import:

- Route: `POST /api/setup/import-snapshot`
- Implementation: [`server/migration-import.ts`](./server/migration-import.ts)
- Spec: [`docs/desktop/migration-snapshot-spec.md`](./docs/desktop/migration-snapshot-spec.md)

Import constraints:

- Intended for fresh Host installs only.
- Preserves IDs and synthesizes legacy non-login users when needed.
- Normalizes settings and message templates.

## 5) Critical workflows to understand before editing

### Host setup and client approval

- Host setup routes are loopback-only (`/api/setup/bootstrap`, `/api/setup/import-snapshot`).
- Client connection uses:
  1. host address + pairing code trust,
  2. optional host-side approval handshake (`/api/setup/handshake/*`).
- Approval requests are stored in-memory (ephemeral map in `server/routes.ts`), not DB-backed.

### Licensing and read-only mode

- License state persisted to `license.json` in data dir.
- Scheduler runs check-ins with backoff/grace logic.
- Non-GET API writes are blocked when snapshot says read-only.
- Desktop Host auto-allowlists license domain(s) for airgap egress.

### Offline outbox behavior (important limitation)

- Queueing only applies to selected mutating `jobs` routes (`client/src/lib/queryClient.ts`).
- Not all mutations are offline-safe (for example, many team/settings flows are online-only).
- Flush is ordered and stops at first failure.
- Conflict policy is effectively Host-authoritative, with no sophisticated merge UX yet.

### Job lifecycle

- Status change to terminal (`completed` or `cancelled`) archives and removes active row.
- Past Jobs restore creates active jobs again.
- Redo uses archived job data to create a new active job.
- Identifier mode is office-configurable: patient name vs tray number.

### Messaging/SMS stance

- Desktop UX treats SMS as template/copy flow, not integrated sending.
- Backend SMS routes still exist; Twilio path is gated by env and generally disabled in desktop defaults.

## 6) Security/compliance guardrails currently in code

- `OTTO_AIRGAP=true` + monkeypatched outbound blocking in [`server/airgap.ts`](./server/airgap.ts).
- `OTTO_LAN_ONLY=true` request-level private-IP filter in server middleware.
- Renderer no-internet webRequest guard in Electron.
- PHI access logs (`phi_access_logs`) for key list/detail/comment/archive access points.
- File-based request audit log (`audit_log.jsonl`) with size/retention compaction.
- Error log persistence (`error_log.json`) without response/request payload dumps.
- Offline outbox encrypted in Electron userData storage.

## 7) Dev and build reality

Primary scripts:

- `npm run dev` -> backend + Vite middleware server.
- `npm run desktop` -> Electron shell.
- `npm run build` -> web + server bundle.
- `npm run dist:desktop` -> installers via electron-builder.

Docs worth using first:

- [`docs/desktop/dev.md`](./docs/desktop/dev.md)
- [`docs/desktop/user-guide.md`](./docs/desktop/user-guide.md)
- [`docs/desktop/implementation-checklist.md`](./docs/desktop/implementation-checklist.md)
- [`docs/desktop/open-questions.md`](./docs/desktop/open-questions.md)

## 8) Verified checks in this workspace

Ran on March 2, 2026:

- `npm run test:local-first` -> passes.
- `npm run test:migration-import` -> fails due `better-sqlite3` native module Node ABI mismatch (`NODE_MODULE_VERSION 121` vs required `127`).
- `npm run check` -> currently fails with many TypeScript errors (server route nullability/typing, schema recursion typing, unknown query types in some client components, and some storage insert typings).

Takeaway: this repo currently runs for product flows, but static/type/test hygiene is not green.

## 9) Known risks and technical debt

- Typecheck is significantly red; treat this as an active debt item before large refactors.
- Setup handshake requests are in-memory only; host restart clears pending approvals.
- Web-era code remains and can create false confidence about what is truly supported in desktop UX.
- Two websocket implementations exist (`sync-websocket.ts` in use, `websocket.ts` appears legacy/unused).
- Bulk action buttons in Worklist UI are present but not implemented.
- Migration path is partly schema-preserving by convention; no strict migration framework.

## 10) Suggested takeover sequence

1. Stabilize environment parity:
   - rebuild native deps for current Node/Electron toolchain.
   - decide pinned Node version for contributors.
2. Get CI-style quality baseline:
   - make `npm run check` green.
   - make both test scripts pass in a clean install.
3. Separate desktop-supported paths from legacy web paths:
   - document and gate unsupported routes/features explicitly.
4. Harden recovery and operations:
   - complete backup banner/recovery guide gaps from checklist.
5. Address offline sync edge cases:
   - document/implement explicit conflict messaging policy.

## 11) File hotspots (most likely to matter for future work)

- Desktop runtime and setup: [`desktop/main.js`](./desktop/main.js)
- API surface and workflow rules: [`server/routes.ts`](./server/routes.ts)
- Schema/bootstrap compatibility: [`shared/schema.ts`](./shared/schema.ts), [`server/sqlite-bootstrap.ts`](./server/sqlite-bootstrap.ts)
- Auth model and identifiers: [`server/auth.ts`](./server/auth.ts), [`server/auth-identifiers.ts`](./server/auth-identifiers.ts)
- Offline queue: [`client/src/lib/offline-outbox.ts`](./client/src/lib/offline-outbox.ts), [`client/src/lib/queryClient.ts`](./client/src/lib/queryClient.ts)
- Worklist and job editing UX: [`client/src/components/jobs-table.tsx`](./client/src/components/jobs-table.tsx), [`client/src/components/job-dialog.tsx`](./client/src/components/job-dialog.tsx)
- Setup/auth UX: [`client/src/pages/setup-page.tsx`](./client/src/pages/setup-page.tsx), [`client/src/pages/auth-page.tsx`](./client/src/pages/auth-page.tsx)

