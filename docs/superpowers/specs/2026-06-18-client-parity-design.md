# Client Parity (tray + auto-start) — Design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan
**Area:** otto-job-tracker desktop (Electron main process)

## Problem

Otto's always-on "resident app" behavior is **host-only by design**. Tray icon,
close-to-tray (hide instead of quit), stay-alive on `window-all-closed`, and
auto-start-on-reboot (login item) are all gated on `isAlwaysOnHostActive(config)`,
which requires `config.mode === "host"` ([always-on.js](../../../desktop/lib/always-on.js)).

Consequently a **client** today: quits fully when its window closes, shows no tray
icon, and never auto-starts. On the user's setup (macOS = always-on host, Windows =
clients) this surfaced as three reports:

1. *(Separate bug, already fixed)* Mac host couldn't reopen its window — "port in use."
   Fixed via `shouldStartHostServer` (reopen is now idempotent). Out of scope here.
2. Windows client doesn't minimize to tray / has no tray icon.
3. Windows client doesn't auto-start on reboot (the Mac host does).

(2) and (3) are current intended behavior, not bugs. The decision (below) is to extend
resident behavior to clients.

## Decision

Give clients the same resident behavior as the host — **minimize-to-tray on close,
stay alive with all windows closed, and auto-start on reboot** — **default-on with a
per-machine opt-out**, mirroring the host's existing model. Auto-started clients launch
**visibly**. The `NO OFFLINE OUTBOX` rule is preserved: a client with the host down stays
read-only and never queues mutations (already enforced; this feature only keeps the
process/tray alive longer).

### Non-goals
- No change to host behavior (byte-for-byte), except the shared bug fix in §3.
- No offline outbox / offline mutation queue. Clients remain read-only when the host is down.
- No change to the existing client reconnect/offline UX (it already exists and is reused).
- Items in §7 (session clearing, recovery-token encryption, etc.) are explicitly deferred.

## Approach (approved: "A — one unified predicate")

A single pure predicate replaces the host-only gate at the four resident-behavior sites;
host-server semantics keep using `isAlwaysOnHostActive`.

## 1. Gating predicate

New Electron-free helper in [always-on.js](../../../desktop/lib/always-on.js), in the
same defensive style as `isAlwaysOnHostActive`:

```js
export function isResidentApp(config, env = process.env) {
  if (!isAlwaysOnHostCapable(env)) return false;
  if (config?.mode === "host")   return config?.alwaysOnHost       !== false;
  if (config?.mode === "client") return config?.keepClientResident !== false;
  return false;
}
```

`isAlwaysOnHostActive` is **retained** and continues to gate genuine host-server
semantics only: the before-quit shutdown backup and the "clients still connected"
quit warning. It is removed from the four resident-behavior sites below.

The four call sites switch `isAlwaysOnHostActive` → `isResidentApp`:

| # | Site | File (approx) |
|---|------|---------------|
| ① | startup `createTray()` gate | main.js ~3060 |
| ② | `_handleMainWindowClose` hide-to-tray | main.js ~704 |
| ③ | `window-all-closed` stay-alive | main.js ~3109 |
| ④ | `_reconcileLoginItem` `openAtLogin` | main.js ~581 |

The `shouldStartHostServer` reopen fix is unaffected — clients have no embedded server.

## 2. Config field + opt-out toggle

- **`keepClientResident`** is **not** added to `getDefaultConfig()`. This mirrors
  `alwaysOnHost`, which is also absent from defaults and written only when a machine is
  opted out. The predicate's `!== false` means *absent = resident (default-on)*, so all
  existing clients become resident on upgrade with **zero migration**.
- `_toggleAlwaysOnHost` → **renamed `_toggleResidentMode`** and **branches by mode**:
  host writes `config.alwaysOnHost`, client writes `config.keepClientResident`. (Today it
  writes `alwaysOnHost` unconditionally — wrong for a client.) It still calls
  `_reconcileLoginItem`, (re)creates/destroys the tray, and rebuilds the app menu.
- **Menu** ([menu.js:38](../../../desktop/lib/menu.js)): the "Keep Otto Running in the
  Background" checkbox drops its `isHost` gate — shown whenever `alwaysOnHostCapable`.
  Its `checked` state binds to a new resident-aware prop computed from `isResidentApp(config)`
  (works for both modes). `_setAppMenu` ([main.js ~560](../../../desktop/main.js)) computes
  and passes that prop.

## 3. Toggle-off-while-hidden trap (also fixes an existing host bug)

Turning resident **off** calls `_destroyTray()`. If the window is currently hidden-to-tray,
destroying the tray strands the user with no way to reopen — already true for the **host**
today on Windows (and any platform without a dock fallback).

**Fix:** in `_toggleResidentMode`, when turning resident **off**, if `mainWindow` exists,
is not destroyed, and is not visible, **`show()` it first** (and on a darwin **host**,
`app.dock.show()`), *then* `_destroyTray()`. This fixes the latent host bug and the client case.

## 4. Tray copy (host strings are wrong for clients)

`_updateTrayMenu`, the tray tooltip ([main.js:633](../../../desktop/main.js)), and the
one-time hidden-to-tray notice ([main.js:690](../../../desktop/main.js)) hardcode host
language ("Otto server is running", "N workstations connected", "Quit Otto (take office
offline)", "Workstations stay connected"). Each branches on `config.mode`:

- **Host:** unchanged copy and the live workstation count.
- **Client:** "Open Otto" / "Otto is connected to the office" / "Quit Otto"; tooltip
  "Otto Tracker"; notice "Otto stays running — click the Otto icon in the taskbar to
  reopen this window." No workstation count (clients have no server / no
  `__ottoGetConnectedClientCount`).

The selection of copy-by-mode is extracted into a small pure helper so it is unit-testable
without Electron.

## 5. Auto-start visibility

`_reconcileLoginItem` uses `isResidentApp`. `openAsHidden` becomes **host-only**:
`config.mode === "host" && process.platform === "darwin"`. Clients launch **visibly** so
the user sees their workspace after reboot. If the host isn't up yet, the **existing**
reconnect overlay handles it — indefinite backoff + "Host is offline … read-only …
reconnecting" with a "Try Now" button ([windows.js:256-278](../../../desktop/lib/windows.js)) —
and recovers automatically when the host returns.

## 6. Reopen robustness (macOS + Windows)

- `app.dock.hide()` in `_handleMainWindowClose` and `_showMainWindow` becomes **host-only**.
  A client is user-facing and should remain in the Dock / Cmd-Tab; only a back-office host
  hides from the Dock.
- `second-instance` (the Windows "relaunch to reopen" path): if `mainWindow` is destroyed →
  reopen via `_showMainWindow()`; if it exists → `show()` in addition to `restore()`/`focus()`.
  Today it only focuses a live window, so a Windows client whose window was closed cannot be
  reopened by relaunching the exe. `activate` (macOS dock click) already relaunches a destroyed
  window and calls `show()` — verify parity, no change expected there.

## 7. Out of scope (evaluated during adversarial review, deliberately deferred)

None are made worse by this feature; bundling them would expand scope without serving the goal.

- **Client session-cookie clearing on hide / on update-relaunch** — existing, *deliberate*
  behavior: client sessions survive for "invisible reconnection" ([main.js ~3149](../../../desktop/main.js)).
  Resident mode does not weaken `NO OFFLINE OUTBOX` (enforced by host-as-source-of-truth +
  read-only offline overlay).
- **`clientRecoveryToken` stored plaintext on disk** — pre-existing and documented as such
  ([config.js:90](../../../desktop/lib/config.js)). Candidate for a separate security task.
- **Auto-update relaunch vs login-item double-launch** — covered by the single-instance
  lock ([main.js:125](../../../desktop/main.js)); the second instance quits.
- **Zombie-process timeout in `window-all-closed`** — YAGNI.
- **Order-sheet watcher while a client is fully hidden** — keeps running in the main process
  (desired: the front-desk machine keeps ingesting); changing watcher config requires opening
  the window (normal). No change needed.

## 8. Testing

**Unit (Node test runner, extend [always-on-host.test.ts](../../../tests/always-on-host.test.ts)
or a sibling):**
- `isResidentApp` truth table across every `(capability, mode, field)` combination, including
  missing/null/odd config (must never throw). Pin: capability-off ⇒ always false; client
  default-on; client opt-out (`keepClientResident: false`) ⇒ false; host path unchanged.
- `_toggleResidentMode` field selection: a pure helper that, given `mode`, returns which field
  to flip and the next value — tested directly (the Electron wiring is thin).
- Tray copy / hidden-to-tray notice: pure copy-by-mode helper returns host vs client strings.

**Manual checklist (login items, tray, reboot cannot be unit-tested):**
- *Windows client:* reboot → Otto auto-starts **visibly**; close window → hides to tray;
  click tray icon → reopens; **opt-out while hidden** → window returns + tray disappears;
  host down at launch → offline overlay shown → auto-recovers when host returns; relaunch
  exe while running → existing window reopens (not a second instance).
- *macOS host (regression):* close → hides to menu-bar tray; reopen → instant (no rebuild,
  no "port in use"); auto-start hidden on login; opt-out while hidden → window returns; Dock
  hides on hide-to-tray; quit warns when clients connected.

## Affected files

- [desktop/lib/always-on.js](../../../desktop/lib/always-on.js) — `isResidentApp` (+ optional copy/field helpers, or a sibling module).
- [desktop/lib/config.js](../../../desktop/lib/config.js) — document `keepClientResident` semantics (no default added).
- [desktop/lib/menu.js](../../../desktop/lib/menu.js) — generalize the "Keep Otto Running" toggle to both modes.
- [desktop/main.js](../../../desktop/main.js) — four gate swaps; `_toggleResidentMode`; tray copy/tooltip/notice by mode; `openAsHidden`/dock host-only; `second-instance`/`activate` reopen.
- [tests/always-on-host.test.ts](../../../tests/always-on-host.test.ts) — extend with the cases above.
