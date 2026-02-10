# Desktop/offline conversion plan

## Goal

Package this app as an executable desktop application that can run fully offline inside a healthcare office network, with **local data storage** and **HIPAA-oriented safeguards**.

## Current architecture (today)

- Frontend: Vite + React + Wouter + TanStack Query
- Backend: Express + Passport (session auth) + Drizzle ORM
- DB: SQLite (file DB via `OTTO_SQLITE_PATH` / `OTTO_DATA_DIR`)
- Optional integrations: Twilio (SMS), OpenAI (AI summaries)

The simplest desktop conversion keeps the web UI and API exactly as-is, but runs them locally and packages them in a desktop shell.

## Recommended target architecture (phase 1)

**One executable, two modes:**

1) **Host (SOT) mode**
- Runs the Express API locally
- Stores the database locally *on the host computer* (SQLite file in the app data directory)
- Serves the web UI/API to desktop clients on the LAN

2) **Client mode**
- Does **not** store the office database locally (may temporarily store a small **encrypted offline queue** to sync writes)
- Opens a desktop window pointed at the Host’s URL (for example `https://SOT-IP:5150`) — no separate browser required
- First-time connection uses a **pairing code** (shown on the Host) to trust the Host certificate

This matches your “single source of truth” idea and avoids complex multi-writer sync.

Practical note: the server bind address is configurable via `OTTO_LISTEN_HOST` (for example `127.0.0.1` for single-machine use, or `0.0.0.0` to allow LAN clients).

## Packaging options (recommended: Electron first)

- **Electron** (recommended for phase 1): fastest path because this app is already Node + web UI; easiest to bundle a local server and reuse current code.
- **Tauri**: smaller binaries and tighter OS integration, but you’ll still need a backend story (Rust API, or shipping Node as a sidecar).
- **.NET MAUI / Flutter**: great desktop frameworks, but would require rewriting the UI and a significant portion of the app.

## Database options (optimize for “no installs”)

To keep setup simple for non-technical office staff, avoid requiring them to separately install/configure a database server.

Recommended (current direction): **SQLite (file DB)**
- Simplest distribution and backup story
- Single Host process owns the DB; LAN clients talk to the Host over HTTP(S)

## Security/HIPAA guardrails (baseline)

- **No cloud dependencies required for core workflows** (jobs, comments, archives, office settings).
- **Outbound network egress disabled by default** using `OTTO_AIRGAP=true`.
- **Audit logging**: continue using `phi_access_logs` for access events; add/verify admin audit logs.
- **Encrypt data at rest**: require full-disk encryption on the host, and consider DB-level encryption in later phases.
- **Encrypt data in transit (LAN)**: prefer TLS between clients and the host.

Details: `docs/security/hipaa.md`.

## Phased implementation

### Phase 0 — repo hygiene (done in this branch)
- Remove committed SQL/CSV exports and Replit metadata/agent state.
- Add guardrails to reduce accidental PHI logging.

### Phase 1 — offline host on a single machine (recommended first milestone)
- Run the existing Express server against a **local SQLite database file** on the Host computer.
- Package as a desktop app (recommended: Electron) that launches the local server + opens the UI.

### Phase 2 — LAN clients (baseline implemented)
- “Connect to host” UX (saved host address + pairing code).
- HTTPS from the host (self-issued cert + pinning in the desktop client).
- Backup/restore flows (Host menu).

For a plain-language setup walkthrough, see `docs/desktop/user-guide.md`.

### Phase 3 — reduce operational footprint
- Add encryption-at-rest options for the local database (for example OS full-disk encryption + optional DB file encryption).
- Replace cookie sessions with token-based auth if you need cross-origin deployment patterns.

### Phase 4 — licensing (web only, no PHI)
If the app must never connect to the internet, use offline licensing instead:
- Signed license file import + offline validation (see `docs/security/licensing.md`).

## Open questions

See `docs/desktop/open-questions.md`.
