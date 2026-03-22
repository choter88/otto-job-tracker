# Licensing Security

This document describes the security properties of Otto Tracker's licensing system. The licensing system communicates with the Otto portal control plane for activation and periodic check-ins. **No PHI is ever sent to the portal.**

## Host Token Lifecycle

### Activation

1. The Host operator authenticates with the portal via email/password (`/api/setup/portal-auth` calls `portalDesktopAuth`), receiving a short-lived portal token.
2. The portal token is exchanged for a persistent host token via the `issue-and-consume` endpoint (`portalIssueAndConsume`). The portal creates a host record tied to the office subscription.
3. The host token, activation timestamp, and server time offset are persisted locally in `license.json`.

### Check-in

- The Host periodically checks in with the portal (`/license/v1/checkin`) to confirm the subscription is active.
- Check-in payload includes: `hostToken`, `installationId`, `hostFingerprint256`, `appVersion`, and optionally `localAddresses`, `pairingCode`, and `tlsFingerprint256` (for Client discovery).
- The portal returns: `serverTime`, `nextCheckinDueAt`, `status` (`ACTIVE` or `DISABLED`), and optionally `currentInviteCodeLast4`.

### Deactivation

- If the portal returns HTTP 401 on check-in, the local state is marked `tokenInvalid: true` and the app enters read-only mode.
- The portal can disable an office (`status: DISABLED`), which also triggers read-only mode.

## Token Storage

### Server-side (portal)

Host tokens are stored as SHA-256 hashes on the portal. The portal never stores plaintext host tokens after the initial issue response.

### Client-side (Host machine)

The host token is stored in plaintext in `license.json` inside the data directory (`OTTO_DATA_DIR`, defaults to `~/.otto-job-tracker/`). File permissions are set to `0o600` (owner read/write only) and the directory to `0o700` (owner only).

On packaged desktop installations, the data directory lives under the Electron `userData` path, which is protected by OS-level user account isolation. Full-disk encryption (FileVault on macOS, BitLocker on Windows) is recommended as an additional layer.

Implementation: `server/license-state.ts` (`saveLicenseState`, `loadLicenseState`)

## Check-in Cadence

| Mechanism | Interval | Purpose |
|-----------|----------|---------|
| Startup check-in | 10 seconds after boot | Catch up quickly after restart |
| Periodic scheduler | Every 60 minutes | Regular heartbeat |
| Attempt throttle | 15-minute minimum between attempts | Prevents hammering on repeated failures |
| Success throttle | 4-hour minimum between successful check-ins | Avoids unnecessary portal load |
| Forced check-in | On demand (`forceCheckin()`) | Manual refresh from admin UI |

Implementation: `server/license.ts` (`startLicenseScheduler`, `maybeCheckin`)

## Grace Periods

### Unactivated grace (7 days)

A freshly installed Host can operate in full read-write mode for 7 days without completing activation (`ACTIVATION_GRACE_MS`). After 7 days without a host token, the app enters read-only mode.

### Check-in outage grace (30 days)

If the Host has been activated but cannot reach the portal (network outage, portal downtime), it continues operating in read-write mode for 30 days from the last successful check-in (`CHECKIN_OUTAGE_GRACE_MS`). After 30 days, the app enters read-only mode.

**Note:** These grace periods are being updated to be subscription-aware in a future release.

Implementation: `server/license-state.ts` (`computeLicenseSnapshot`)

## License State Machine

```
UNACTIVATED ──(activate)──► ACTIVE
     │                        │
     │ (7-day grace expires)  │ (check-in overdue)
     ▼                        ▼
  READ_ONLY               GRACE (30-day outage tolerance)
                              │
                              │ (30 days expire)
                              ▼
                          READ_ONLY

  Any state ──(portal returns DISABLED)──► DISABLED (read-only)
  Any state ──(token invalidated/401)──► INVALID (read-only)
```

Modes: `UNACTIVATED`, `GRACE`, `ACTIVE`, `READ_ONLY`, `DISABLED`, `INVALID`

The license snapshot is cached for 24 hours in `server/index.ts` and invalidated immediately when license state changes (e.g. after a check-in or activation).

## Invite Code Security

Invite codes allow Client machines to register with a Host without portal credentials.

- **Format:** 6-digit numeric code
- **Validation:** Invite codes are validated against the portal (`/portal/api/invite-codes/validate`), not locally. The portal is the source of truth for code validity.
- **Portal-side hashing:** Invite codes are SHA-256 hashed on the portal; the portal does not store plaintext codes after generation.
- **Max uses:** Configurable on the portal per code (prevents unlimited registrations from a leaked code).
- **Regeneration:** Owners/managers can regenerate the invite code at any time via `/api/invite-code/regenerate`, which calls `portalRegenerateInviteCode`. The old code is immediately invalidated.

Implementation: `server/license-client.ts` (`portalValidateInviteCode`, `portalGetInviteCode`, `portalRegenerateInviteCode`), `server/routes.ts` (`/api/setup/client-register`)

## Rate Limiting

Rate limiting on licensing endpoints is enforced portal-side. The desktop app handles `RATE_LIMITED` responses from the portal by surfacing a "too many attempts" error to the user.

The local check-in scheduler includes its own throttling (15-minute attempt backoff, 4-hour success throttle) to avoid hitting rate limits during normal operation.

Implementation: `server/routes.ts` (`parseSetupActivationFailure` handles `RATE_LIMITED`), `server/license.ts` (`maybeCheckin`)

## Constant-Time Token Comparison

All secret comparisons (passwords, PINs, host tokens) use `crypto.timingSafeEqual` from Node.js, which performs constant-time byte comparison. This prevents timing side-channel attacks where an attacker could infer token correctness from response latency.

The scrypt-based hash verification in `server/secret-hash.ts`:
1. Splits the stored hash into `hashed` and `salt` components
2. Re-derives the scrypt hash from the supplied secret and stored salt
3. Compares the two buffers using `timingSafeEqual`
4. Returns `false` if buffer lengths differ (before comparison)

Implementation: `server/secret-hash.ts`

## Installation ID and Host Fingerprint

Each Host installation is uniquely identified by two values:

### Installation ID

- Generated once at first launch using `crypto.randomBytes(16).toString("hex")` (128-bit random)
- Persisted in `license.json`
- Sent with every portal request to identify this specific installation
- Used by the portal to detect duplicate activations and track host identity

### Host Fingerprint (`hostFingerprint256`)

- Derived from the TLS certificate's SHA-256 fingerprint when TLS is enabled (`OTTO_TLS=true`)
- Falls back to the installation ID if TLS is not configured
- Normalized to lowercase hex (non-hex characters stripped)
- Sent with check-in requests for portal-side verification
- Used to generate the 12-character pairing code (first 12 hex digits, formatted as `xxxx-xxxx-xxxx`) that Clients use to verify they are connecting to the correct Host

Implementation: `server/license-state.ts` (`ensureLicenseState`, `computeHostFingerprintFromTlsCert`)

## Write Protection

When the license is not in a `writeAllowed` state, all mutating API requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/*` endpoints are blocked with HTTP 403 and a `READ_ONLY` error code. A small allowlist of endpoints (login, logout, licensing, setup) bypasses this check to allow re-activation and authentication.

Implementation: License enforcement middleware in `server/index.ts`
