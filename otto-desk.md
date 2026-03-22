# Otto Desktop App — Context for Claude Code

## What this is

Otto Tracker is a **desktop-first Electron app** for optometry office job/order management. It runs on a LAN — one Host computer runs the server + SQLite database, multiple Client computers connect to it. No patient data (PHI) leaves the LAN. The only internet traffic is licensing check-ins to the Otto Web Portal.

This repo contains the desktop app. The companion repo is the **Otto Web Portal** (ottojobtracker.com), which handles user signup, billing, office management, and the licensing API.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process  (desktop/main.js)           │
│  - Window lifecycle, TLS cert gen, backup/restore   │
│  - Host/Client setup via desktop/setup.html         │
│  - IPC bridge via desktop/preload.cjs               │
│  - Offline outbox encryption                        │
├─────────────────────────────────────────────────────┤
│  Embedded Express Server  (server/)                 │
│  - SQLite via better-sqlite3 + Drizzle ORM          │
│  - Session auth (Passport local strategy)           │
│  - License check-in scheduler                       │
│  - LAN-only + airgap middleware                     │
├─────────────────────────────────────────────────────┤
│  React Frontend  (client/)                          │
│  - Vite + React 18 + Wouter + TanStack Query        │
│  - Radix UI components (client/src/components/ui/)  │
│  - Tailwind CSS                                     │
└─────────────────────────────────────────────────────┘
```

### Two setup UIs

- **`desktop/setup.html`** — Native Electron setup window (used in packaged builds). The Electron main process calls portal APIs directly and communicates with the embedded server via IPC/fetch.
- **`client/src/pages/auth-page.tsx`** — React login page for day-to-day sign-in (Login ID + PIN or password). Shown after setup is complete.

The React `setup-page.tsx` was removed — in Electron, the setup flow redirects to `/auth` and uses `desktop/setup.html` instead.

## Portal ↔ Desktop API Contract

**Canonical reference:** See `docs/portal-desktop-api-contract.md` in the otto-web repo for full request/response schemas, auth patterns, error codes, and field-level documentation.

Quick summary of endpoints:

| Endpoint | Purpose | Called by |
|----------|---------|-----------|
| `POST /portal/api/auth/desktop-token` | Sign in with portal credentials → short-lived token + office list | `desktop/main.js` |
| `POST /portal/api/desktop/claims/issue-and-consume` | Activate Host → `hostToken` + office/user data (supports idempotency key) | `server/license-client.ts` |
| `POST /license/v1/checkin` | Hourly heartbeat → license status, invite code, subscription period end | `server/license.ts` |
| `POST /license/v1/invite-code` | Get/create invite code for Client pairing | `server/license-client.ts` |
| `POST /license/v1/invite-code/regenerate` | Rotate invite code | `server/license-client.ts` |
| `POST /portal/api/invite-codes/validate` | Client validates invite code during setup | `desktop/main.js` |

### License check frequency

- Scheduler runs hourly (`setInterval` in `server/license.ts`)
- Throttled: skips if last attempt < 15 min ago, skips if last success < 4 hours ago
- License snapshot is cached for 24 hours in the write-gate middleware (`server/index.ts`)
- Grace period logic allows the app to remain writable for days after a missed check-in

## Brand New User Flow

1. **Sign up on portal** → creates user, office (subscriptionStatus=trialing), no host row
2. **Download & install** the desktop app
3. **Step 1 — Portal sign-in**: Enter portal email/password → `desktop-token` → get token + offices
4. **Step 2 — Office confirmation**: Shows the office to activate (with import option). Only offices with `active` or `trialing` subscription are shown. User can choose "Start fresh" or "Import snapshot"
5. **Step 3 — Create owner login**: First name, last name, Login ID, 6-digit PIN (pre-filled from portal user data)
6. **Activation**: Bootstrap calls `issue-and-consume` → portal creates `portal_hosts` row → returns `hostToken`
7. **Running**: License scheduler starts, check-ins report LAN address + pairing code to portal

## Key Files

| Area | Files |
|------|-------|
| Electron main process | `desktop/main.js`, `desktop/preload.cjs`, `desktop/setup.html` |
| Server entry + middleware | `server/index.ts` |
| API routes (91KB, core logic) | `server/routes.ts` |
| Database queries | `server/storage.ts` |
| Schema + migrations | `shared/schema.ts`, `server/sqlite-bootstrap.ts` |
| Licensing | `server/license.ts`, `server/license-client.ts`, `server/license-state.ts`, `server/license-types.ts` |
| Auth | `server/auth.ts`, `server/auth-identifiers.ts` |
| React app entry | `client/src/App.tsx`, `client/src/main.tsx` |
| Login page | `client/src/pages/auth-page.tsx` |
| Main UI | `client/src/pages/dashboard.tsx` |
| Job workflow | `client/src/components/jobs-table.tsx`, `client/src/components/job-dialog.tsx` |
| Offline queue | `client/src/lib/offline-outbox.ts`, `client/src/lib/queryClient.ts` |
| Sync/status bar | `client/src/components/sync-manager.tsx` |
| Settings | `client/src/components/settings-modal.tsx`, `client/src/lib/default-colors.ts` |
| Snapshot import | `server/migration-import.ts`, `docs/desktop/migration-snapshot-spec.md` |

## Dev Commands

```bash
npm run dev              # Backend + Vite dev server (port 5150)
npm run desktop          # Launch Electron shell (run after dev)
npm run build            # Bundle web + server for production
npm run dist:desktop     # Build installers via electron-builder
npm run check            # TypeScript check (has known errors)
npm run test:local-first # Offline outbox test
npm run test:migration-import  # Snapshot import test
```

## Environment Variables

See `.env.example`. Key vars:
- `OTTO_SQLITE_PATH` — SQLite file location
- `SESSION_SECRET` — Express session secret
- `PORT` — Server port (default 5150)
- `OTTO_LISTEN_HOST` — `0.0.0.0` for LAN, `127.0.0.1` for local only
- `OTTO_AIRGAP=true` — Blocks all outbound except allowlisted domains
- `OTTO_LAN_ONLY=true` — Only accepts requests from private IPs
- `OTTO_LICENSE_BASE_URL` — Portal URL (default `https://ottojobtracker.com`)

## Known Issues & Tech Debt

- **Distributed transaction risk** — If `issue-and-consume` succeeds on portal but desktop crashes before persisting `hostToken`, the portal has a stale host row. Idempotency fix in progress (portal will cache responses by idempotency key).

## Security / Compliance

- HIPAA-oriented: airgap, LAN-only, PHI access logging, encrypted offline outbox
- TLS certs auto-generated for packaged Host mode (`selfsigned` package)
- Audit log (JSONL) with configurable retention
- No PHI in portal communication — only licensing metadata
