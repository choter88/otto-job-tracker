# Client Connection & Login UX — Design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan
**Area:** otto-job-tracker — Electron desktop (main + renderer), client login screen, host server

Three related changes to how a client handles a down host, how sessions end, and how users log in.

## Problems & decisions

1. **Client offline = blank screen, no auto-reconnect (BUG).** When a client window opens while the host process is down, the user sees a **blank** screen instead of an offline message, is **not** reconnected when the host returns, and can only recover by fully **exiting and restarting** — closing/reopening the window doesn't help. Root causes ([windows.js](../../../desktop/lib/windows.js), [main.js](../../../desktop/main.js)):
   - The "Host is offline" UI is injected via `executeJavaScript` only on the **5th** failed load (`isClient && loadFailCount === 5`), and the reconnect loop's next `loadURL` immediately navigates away and wipes it → effectively blank.
   - The reconnect loop is cleared by `did-finish-load`; a spurious finish on the error page can stop it, so the host returning never triggers a reload.
   - Resident close **hides** the window; `_showMainWindow` on a hidden (not destroyed) window only `show()`s it — **never reloads** — so the stale blank renderer persists. Exit+restart destroys the window and forces a fresh `loadURL`.
2. **No auto-logout on close.** With resident windows, closing hides the window and the session stays alive — on a shared machine the next person who reopens the tray lands in the previous user's account. **Decision: auto-logout on window close for BOTH host and client.**
3. **Login ID must be typed every time.** **Decision: an editable combobox of the office's approved login IDs** (type-ahead + select), populated from a new public endpoint, **login IDs only** (no names).

**Decision on session timeout:** keep the current **15-minute idle, rolling** timeout ([server/auth.ts:105](../../../server/auth.ts), [:143](../../../server/auth.ts)) unchanged. Active users are never logged out mid-work; auto-logout-on-close covers the walk-away-and-close case.

## A. Client offline + reconnect (robust rewrite)

Replace the fragile "inject overlay on the 5th failure" pattern with a **bundled local offline page + a main-process reconnect controller**.

- **New file `desktop/assets/offline.html`** — a self-contained page (inline CSS/JS, no external deps) that shows "Can't reach the office server — reconnecting…" and a **"Try now"** button. It always renders (local `loadFile`), so the user never sees a blank screen and never waits for a 5th failure.
- **Main-process reconnect controller** (in [windows.js](../../../desktop/lib/windows.js)'s `createWindow`, replacing the current `did-fail-load`/`did-finish-load` block ~lines 213-292): a small per-window state machine.
  - On `did-fail-load` of the **main frame** for the target origin → load `offline.html` (if not already showing it) and (re)arm a single reconnect timer that retries `win.loadURL(targetUrl)` with the existing capped backoff.
  - Track whether the **real app origin** loaded vs the local offline page, so a finished *offline-page* load does NOT reset/stop the reconnect loop. The loop stops only when the **target app** actually loads.
  - The reconnect **timer drives retries automatically** (the user never has to act). The offline page's **"Try now"** button is an optional accelerator: a new preload method `reconnectNow()` → `ipcRenderer.invoke("otto:reconnect:now")` makes the main process retry `loadURL(targetUrl)` immediately. (`offline.html` is loaded into the same webContents, so the `window.otto` preload bridge is available to it; if absent it falls back to no-op and the timer still recovers.)
  - Cache-bust the main document load (`loadURL(targetUrl, { extraHeaders: "pragma: no-cache\n" })`) so a recovered host serves fresh content and a failed load truly fails.
  - Host mode keeps its existing "server didn't start" dialog behavior; only the **client** path uses the offline page.
- **Reload-on-reopen:** `_showMainWindow` ([main.js](../../../desktop/main.js)), when the window exists and is **hidden** (not destroyed), reloads the target URL instead of only `show()`-ing it, so a stale/offline renderer is refreshed on reopen. (Combined with B, reopen lands on a fresh login.)

Result: host down at launch → immediate offline page → auto-reconnect when the host returns → close/reopen also recovers.

## B. Auto-logout on window close (host + client)

When the window is hidden to tray (in `_handleMainWindowClose`, after `win.hide()`), end the session on **both** modes:

- **Guarantee (main process):** clear the window partition's auth state — `win.webContents.session.clearStorageData({ storages: ["cookies", "localStorage", "sessionStorage"] })` + `clearAuthCache()`. This drops the httpOnly session cookie, so the user is logged out regardless of renderer state. (Host partition `persist:otto-host`, client `otto-client` — [windows.js:148](../../../desktop/lib/windows.js).)
- **Server invalidation + audit (best-effort):** just before the storage clear, signal the renderer via a new main→renderer push (`otto:auto-logout`, mirroring the existing `otto:orderSheets:event` subscriber pattern in [preload.cjs](../../../desktop/preload.cjs)); the renderer calls `POST /api/logout` ([use-auth.tsx](../../../client/src/hooks/use-auth.tsx)) so the server destroys the session row and logs the event. The storage-clear runs as a short-delayed backstop so it can't race the logout POST's cookie.
- On reopen, A's reload lands on the **login screen**. The 15-min idle timeout is unchanged for the not-closed walk-away case.

Note: this supersedes the earlier client-parity note that "client sessions survive for invisible reconnection" — the security decision takes precedence; users re-authenticate on reopen.

## C. Login-ID combobox

- **New public endpoint `GET /api/login-ids`** ([server/routes.ts](../../../server/routes.ts)) — no auth, **rate-limited** (per-IP, modest; reuse the lockout-style limiter near [auth.ts:39-66](../../../server/auth.ts)). Resolves the host's single office server-side (no `:id` param needed) and returns `{ loginIds: string[] }` — **login IDs only, no names**. Backed by `getUsersInOffice` ([storage.ts:362](../../../server/storage.ts)) projected to `loginId`. LAN-only app, so exposure is the office network.
- **Login screen** ([auth-page.tsx](../../../client/src/pages/auth-page.tsx)): replace the free-text login-ID input with an **editable combobox** — a text field with a dropdown of approved login IDs that filters as the user types, and still allows typing an ID not in the list (resilience for a brand-new user). Password field unchanged.
- **Freshness:** fetch on mount and **poll every ~45s** while the login screen is shown; no pre-auth websocket. Failures are non-fatal — fall back to a plain text field if the list can't load.

## Cross-cutting interactions
- **A + B:** hide clears session (B); reopen reloads (A) → fresh login screen. If the host is down at reopen, the reload shows the offline page (A) instead of blank.
- **A + host:** the offline page is client-only; host keeps its boot/“server didn’t start” flow.
- **B + resident:** the process/tray stay alive (resident); only the *session* is cleared. Main-process work (order-sheet watcher) is unaffected (not session-bound).

## Out of scope (deliberate)
- No offline outbox / offline writes — clients stay read-only when the host is down (unchanged).
- No change to the 15-min idle timeout or its rolling behavior.
- `clientRecoveryToken` plaintext-at-rest (pre-existing) — separate security task if desired.
- No staff **names** exposed pre-auth (login IDs only).

## Testing
**Unit (pure helpers, Node test runner):**
- A: extract the reconnect decision into a pure helper (e.g. given `{ failedUrl, targetOrigin, isShowingOfflinePage }` → `{ action: "show-offline" | "retry" | "online", nextDelayMs }`) and test the state transitions incl. "offline-page load must not stop the loop."
- C: a pure helper that filters/normalizes the login-ID list for the combobox (type-ahead match, dedupe, empty-list fallback) — tested directly; and a server-side projection test that `/api/login-ids` returns only `loginId`s for the office (no names/passwords).

**Manual QA (Electron/UI, needs a packaged build):**
- A: start client with host **down** → offline page shows immediately (not blank); bring host **up** → auto-reconnects; close+reopen while down → still offline page (not stuck blank); close+reopen after host up → loads app.
- B: log in on client; close window (hides to tray); reopen → **login screen** (logged out). Repeat on host. Confirm a `POST /api/logout` audit entry where applicable.
- C: login screen shows the combobox; typing filters; selecting fills the ID; adding/removing an office user updates the list within ~45s; list-fetch failure falls back to a typeable field.

## Affected files
- `desktop/assets/offline.html` (**new**)
- `desktop/lib/windows.js` — reconnect controller + offline page + cache-bust
- `desktop/main.js` — `_showMainWindow` reload-on-reopen; `_handleMainWindowClose` auto-logout-on-hide
- `desktop/preload.cjs` — `onAutoLogout` subscriber (+ any offline "try now" hook)
- `server/routes.ts` — public `GET /api/login-ids`; `server/storage.ts` — login-ID projection if needed
- `server/auth.ts` / `server/middleware.ts` — reuse rate-limiter; ensure the new route is unauthenticated
- `client/src/pages/auth-page.tsx` — login-ID combobox; new hook to fetch/poll `/api/login-ids`
- `client/src/hooks/use-auth.tsx` — reuse logout for the `otto:auto-logout` event
- Tests under `tests/` for the two pure helpers + the endpoint projection
