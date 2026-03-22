# HIPAA Technical Safeguards

This document describes technical controls implemented in Otto Tracker that support HIPAA compliance. **HIPAA compliance requires a combination of technical controls, administrative policies, workforce training, and vendor management.** This document covers only the technical layer.

## PHI Handling: LAN-Only Architecture

Otto Tracker stores and processes ePHI exclusively on the office LAN. The Host computer holds the SQLite database; Client machines do not store the database locally.

- **No PHI is transmitted to the portal.** Licensing check-ins, activation, and invite code operations send only metadata (installation ID, host fingerprint, app version). Patient/job data never leaves the LAN.
- **Clients connect to the Host over the LAN** (e.g. `https://192.168.x.x:5150`). All PHI reads and writes go through the Host's Express API.

## Airgap Mode (`OTTO_AIRGAP=true`)

When enabled, Otto Tracker monkey-patches Node's `http.request`, `https.request`, and `globalThis.fetch` to block all outbound network calls to non-local hostnames. Only connections to `localhost`, `127.0.0.1`, `::1`, RFC 1918 addresses, `.local` hostnames, and bare hostnames are allowed.

An allowlist (`OTTO_EGRESS_ALLOWLIST`, comma-separated hostnames) permits specific external hosts (e.g. the licensing portal) while blocking everything else.

Implementation: `server/airgap.ts`

## LAN-Only Middleware (`OTTO_LAN_ONLY=true`)

Enabled by default (opt-out via `OTTO_LAN_ONLY=false`). Every inbound HTTP request is checked against private IP ranges before reaching any route handler. Requests from non-private IPs receive `403 LAN only`.

Recognized private ranges:
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `127.0.0.0/8`, `169.254.0.0/16`
- IPv6 loopback (`::1`), unique-local (`fc00::/7`), link-local (`fe80::/10`)

When `OTTO_TRUST_PROXY=true`, the middleware inspects `X-Forwarded-For` to determine the true client IP.

Implementation: LAN-only middleware in `server/index.ts`

## Session Timeouts

- **Timeout duration:** 8 hours (`SESSION_TIMEOUT_MS = 1000 * 60 * 60 * 8`).
- **Rolling refresh:** `rolling: true` in the session configuration resets the cookie `maxAge` on every request, so active users are not logged out while working.
- **Persistent session store:** Sessions are stored in a dedicated SQLite database (`sessions.sqlite` in `OTTO_DATA_DIR`), not in-memory. Sessions survive Host restarts. The store auto-prunes expired sessions at the timeout interval.

Implementation: `server/auth.ts`

## Audit Logging

Otto Tracker maintains three layers of audit logging:

### 1. PHI Access Logs (SQLite table: `phi_access_logs`)

Records access to patient-identifiable data. Each entry captures:
- `userId`, `officeId` (who accessed)
- `action` (`view`, `create`, `update`, `delete`, `export`)
- `entityType` (`job`, `comment`, `archived_job`, `patient_list`)
- `entityId`, `orderId` (what was accessed)
- `ipAddress`, `userAgent` (from where)
- `createdAt` timestamp

PHI access logging is called inline in route handlers via the `logPhiAccess()` helper. Logging failures are caught and logged to console without interrupting the request.

Implementation: `server/routes.ts` (helper), `shared/schema.ts` (table definition)

### 2. Admin Audit Logs (SQLite table: `admin_audit_logs`)

Records administrative actions (user management, office settings changes, role changes). Each entry captures:
- `adminId` (who performed the action)
- `action`, `targetType`, `targetId` (what was done)
- `metadata` (JSON details)
- `createdAt` timestamp

Implementation: `shared/schema.ts` (table definition)

### 3. Request Audit Log (JSONL file)

All mutating API requests (`POST`, `PUT`, `PATCH`, `DELETE`) and all access failures (`401`, `403`) and server errors (`5xx`) are logged to a JSONL file at `$OTTO_DATA_DIR/audit_log.jsonl` (configurable via `OTTO_AUDIT_LOG_PATH`).

Each entry captures:
- `timestamp`, `method`, `path` (normalized to remove UUIDs/IDs)
- `statusCode`, `durationMs`, `outcome` (`success`, `denied`, `error`)
- `userId`, `officeId`, `role`
- `ipAddress`, `userAgent` (included on failures)

Auto-pruning:
- Retention: 30 days by default (`OTTO_AUDIT_LOG_RETENTION_DAYS`)
- Max file size: 5 MB by default (`OTTO_AUDIT_LOG_MAX_BYTES`)
- Compaction runs every 100 writes or when file size exceeds the maximum

File permissions: `0o600` (owner read/write only), directory permissions: `0o700`.

Implementation: `server/audit-logger.ts`, wired in `server/index.ts`

### 4. Error Log (JSON file)

HTTP errors (4xx and 5xx responses) are logged to `$OTTO_DATA_DIR/error_log.json` (configurable via `OTTO_ERROR_LOG_PATH`). Captures method, path, status code, error message, user/office IDs, and duration. Capped at 1,000 entries (ring buffer). No request/response bodies are logged to avoid capturing ePHI.

Implementation: `server/error-logger.ts`

## Encrypted Offline Outbox

When a Client is temporarily disconnected from the Host, mutating requests are queued in an offline outbox on the Client machine. The outbox is encrypted at rest using Electron's `safeStorage` API, which delegates to the platform-native credential store:

- **macOS:** Keychain
- **Windows:** DPAPI
- **Linux:** libsecret / kwallet

The outbox file (`otto-outbox.json`) is stored in Electron's `userData` directory. The payload is encrypted to a Base64 string using `safeStorage.encryptString()` and decrypted with `safeStorage.decryptString()`. If `safeStorage` is unavailable, the outbox falls back to plaintext with a logged warning.

Outbox items are flushed (replayed against the Host API) when connectivity is restored.

Implementation: `desktop/main.js` (encryption bridge), `client/src/lib/offline-outbox.ts` (queue logic)

## Password Requirements

HIPAA-compliant password complexity is enforced on all user-facing password fields:

- Minimum 12 characters
- At least one uppercase letter (`A-Z`)
- At least one lowercase letter (`a-z`)
- At least one digit (`0-9`)
- At least one special character (`!@#$%^&*()_+-=[]{}|;':",./<>?`)

Passwords are hashed using `scrypt` with a 16-byte random salt and 64-byte key length. Verification uses `crypto.timingSafeEqual` to prevent timing attacks.

Implementation: `server/auth.ts` (`validatePasswordComplexity`), `server/secret-hash.ts`

## PIN Requirements

PIN authentication is available for Client (desktop) users as a faster alternative to passwords:

- Exactly 6 digits (numeric only)
- PINs are hashed with the same scrypt + timingSafeEqual scheme as passwords
- PIN login requires both a Login ID and the PIN

Implementation: `server/auth.ts` (`/api/login/pin`), `server/auth-identifiers.ts`

## TLS on LAN

When `OTTO_TLS=true`, the Host serves HTTPS using a self-signed TLS certificate:

- Certificate and key paths are configured via `OTTO_TLS_CERT_PATH` and `OTTO_TLS_KEY_PATH`
- The `selfsigned` npm package generates certificates at first launch in packaged (Electron) mode
- The certificate's SHA-256 fingerprint is used as the `hostFingerprint256` for licensing and Client pairing
- Clients trust the Host by verifying the certificate fingerprint (pinning) during the initial pairing flow, using a 12-character pairing code derived from the fingerprint

Implementation: `server/routes.ts` (`createAppServer`), `server/license-state.ts` (fingerprint extraction)

## Secure Cookies

Session cookies are configured with defense-in-depth settings:

| Attribute   | Value                                                       |
|-------------|-------------------------------------------------------------|
| `httpOnly`  | `true` (not accessible to client-side JavaScript)           |
| `sameSite`  | `lax` (mitigates CSRF for cross-origin POST)                |
| `secure`    | `true` in production (cookie only sent over HTTPS); configurable via `OTTO_COOKIE_SECURE` |
| `maxAge`    | 8 hours (matches session timeout)                           |

Implementation: `server/auth.ts`

## Data Minimization

- Request/response bodies are never written to audit or error logs.
- Error messages in the error log are truncated to 300 characters.
- Audit log paths are normalized to replace UUIDs and numeric IDs with `:id` placeholders.
- User agents are only logged on failure responses.
- The `.gitignore` excludes database files, logs, exports, and credentials from version control.

## Administrative and Physical Safeguards (Operational)

These are outside the scope of the application but required for HIPAA:

- Workstation policies (screen lock, access provisioning/deprovisioning)
- Incident response and breach notification process
- Backup and disaster recovery policy (Host backup/restore is built in)
- Business Associate Agreements (BAAs) for any cloud vendors that touch ePHI (SMS provider, AI provider, etc.)
- Workforce training on PHI handling
