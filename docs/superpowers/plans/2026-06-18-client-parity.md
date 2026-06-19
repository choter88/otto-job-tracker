# Client Parity (tray + auto-start) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Otto **clients** the same resident behavior as the always-on host — minimize-to-tray on close, stay alive with all windows closed, and auto-start on reboot — default-on with a per-machine opt-out, without changing host behavior or the no-offline-outbox rule.

**Architecture:** Replace the host-only gate `isAlwaysOnHostActive` at the four resident-behavior call sites with a single pure predicate `isResidentApp` that covers host *and* client. Mode-specific copy and the per-mode opt-out field are extracted into pure, unit-tested helpers in `desktop/lib/always-on.js`; the Electron wiring in `desktop/main.js` and the menu in `desktop/lib/menu.js` consume them.

**Tech Stack:** Electron (main process, ES modules), Node.js built-in test runner via `tsx`, electron-builder (NSIS on Windows, dmg/zip on macOS).

## Global Constraints

- **Stay on `main`. Do NOT commit per task.** A single `git add -A && git commit && git push` happens once, in the final task, after full verification. (Per user instruction this session.)
- **Never edit `package.json` `version`.** Releases are cut by `scripts/release-*`. Do not bump it.
- **No offline outbox.** A resident client with the host down stays read-only and never queues mutations. This feature only keeps the process/tray alive longer; it must not add any offline-write path.
- **Capability gate unchanged.** All resident behavior remains gated on the `OTTO_ALWAYS_ON_HOST === "true"` capability (`isAlwaysOnHostCapable`). With it unset (production default), every path stays inert.
- **Default-on semantics via absence.** `keepClientResident` is NOT added to `getDefaultConfig()`; the predicate uses `!== false`, so *absent = resident*. Mirrors the existing `alwaysOnHost` field.
- **`isAlwaysOnHostActive` is retained** and used ONLY for host-server semantics (shutdown backup, "clients still connected" quit warning). It is removed from the four resident-behavior sites.
- **Verification per task:** `node --check` on every edited `.js` file, then `npm run test:all` must stay green (exit 0). Tasks 1–2 add unit tests (true TDD); Tasks 3–6 are Electron-coupled wiring verified by syntax-check + full suite + the manual checklist in Task 7 (this matches the repo's existing pattern: pure logic is unit-tested, main-process wiring is not).

**Reference spec:** `docs/superpowers/specs/2026-06-18-client-parity-design.md`

---

### Task 1: `isResidentApp` predicate

**Files:**
- Modify: `desktop/lib/always-on.js` (add `isResidentApp` after `isAlwaysOnHostActive`)
- Test: `tests/always-on-host.test.ts` (extend; already imports from `../desktop/lib/always-on.js`)

**Interfaces:**
- Produces: `isResidentApp(config, env = process.env) => boolean` — true when the app should be resident (tray + stay-alive + login item). Host: `alwaysOnHost !== false`; client: `keepClientResident !== false`; both require capability on.

- [ ] **Step 1: Write the failing tests**

Add to `tests/always-on-host.test.ts`. First extend the import line:

```ts
import { isAlwaysOnHostCapable, isAlwaysOnHostActive, shouldStartHostServer, isResidentApp } from "../desktop/lib/always-on.js";
```

Then append these tests (reuse the existing `ON` / `OFF` constants at the top of the file):

```ts
test("isResidentApp: capability off is always inert", () => {
  assert.equal(isResidentApp({ mode: "host" }, OFF), false);
  assert.equal(isResidentApp({ mode: "client" }, OFF), false);
});

test("isResidentApp: host mirrors always-on (default-on, opt-out wins)", () => {
  assert.equal(isResidentApp({ mode: "host" }, ON), true);
  assert.equal(isResidentApp({ mode: "host", alwaysOnHost: true }, ON), true);
  assert.equal(isResidentApp({ mode: "host", alwaysOnHost: false }, ON), false);
});

test("isResidentApp: client is default-on once capable, opt-out wins", () => {
  assert.equal(isResidentApp({ mode: "client" }, ON), true);
  assert.equal(isResidentApp({ mode: "client", keepClientResident: true }, ON), true);
  assert.equal(isResidentApp({ mode: "client", keepClientResident: false }, ON), false);
});

test("isResidentApp: missing/odd config never throws", () => {
  assert.equal(isResidentApp(undefined, ON), false);
  assert.equal(isResidentApp(null, ON), false);
  assert.equal(isResidentApp({}, ON), false);
  assert.equal(isResidentApp({ mode: "weird" }, ON), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd otto-job-tracker && npm run test:always-on-host`
Expected: FAIL — `isResidentApp` is not exported (ReferenceError / undefined).

- [ ] **Step 3: Implement `isResidentApp`**

In `desktop/lib/always-on.js`, add immediately after the `isAlwaysOnHostActive` function:

```js
// Whether the app should run RESIDENT — keep a tray, stay alive with all
// windows closed, and auto-start at login. Unifies the host's always-on gate
// with the client equivalent so the four resident-behavior sites share one
// predicate. Host-SERVER semantics (shutdown backup, connected-client warning)
// keep using isAlwaysOnHostActive, NOT this.
//
// Default-on once capable: a Host stays resident unless alwaysOnHost === false;
// a Client stays resident unless keepClientResident === false. Both fields are
// absent from getDefaultConfig and written only on opt-out.
export function isResidentApp(config, env = process.env) {
  if (!isAlwaysOnHostCapable(env)) return false;
  if (config?.mode === "host") return config?.alwaysOnHost !== false;
  if (config?.mode === "client") return config?.keepClientResident !== false;
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd otto-job-tracker && npm run test:always-on-host`
Expected: PASS — all cases green (the 8 existing + the 4 new).

---

### Task 2: Pure copy + opt-out-field helpers

**Files:**
- Modify: `desktop/lib/always-on.js` (add `residentToggleField` and `residentCopy`)
- Test: `tests/always-on-host.test.ts` (extend)

**Interfaces:**
- Produces: `residentToggleField(mode) => "alwaysOnHost" | "keepClientResident"` — which config field the opt-out toggle flips for the given mode.
- Produces: `residentCopy(mode) => { trayTooltip, trayStatusLabel, trayQuitLabel, showWorkstationCount, hiddenNoticeBody }` — mode-specific tray/notice strings. `showWorkstationCount` is true only for host.

- [ ] **Step 1: Write the failing tests**

Extend the import in `tests/always-on-host.test.ts`:

```ts
import { isAlwaysOnHostCapable, isAlwaysOnHostActive, shouldStartHostServer, isResidentApp, residentToggleField, residentCopy } from "../desktop/lib/always-on.js";
```

Append:

```ts
test("residentToggleField selects the per-mode opt-out field", () => {
  assert.equal(residentToggleField("host"), "alwaysOnHost");
  assert.equal(residentToggleField("client"), "keepClientResident");
});

test("residentCopy: host keeps server-centric copy + workstation count", () => {
  const c = residentCopy("host");
  assert.equal(c.showWorkstationCount, true);
  assert.equal(c.trayTooltip, "Otto Tracker — office server");
  assert.match(c.trayStatusLabel, /server is running/);
  assert.match(c.trayQuitLabel, /take office offline/);
  assert.match(c.hiddenNoticeBody, /Workstations stay connected/);
});

test("residentCopy: client uses connection copy, no server/count language", () => {
  const c = residentCopy("client");
  assert.equal(c.showWorkstationCount, false);
  assert.equal(c.trayTooltip, "Otto Tracker");
  assert.equal(c.trayQuitLabel, "Quit Otto");
  assert.doesNotMatch(c.trayStatusLabel, /server/i);
  assert.doesNotMatch(c.hiddenNoticeBody, /Workstations stay connected/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd otto-job-tracker && npm run test:always-on-host`
Expected: FAIL — `residentToggleField` / `residentCopy` not exported.

- [ ] **Step 3: Implement the helpers**

In `desktop/lib/always-on.js`, append after `isResidentApp`:

```js
// The per-machine opt-out field the resident toggle flips, by mode. Host and
// client keep separate fields so a client toggle never mutates host semantics.
export function residentToggleField(mode) {
  return mode === "host" ? "alwaysOnHost" : "keepClientResident";
}

// Mode-specific copy for the tray, tooltip, and the one-time hide-to-tray
// notice. A client has no embedded server and no connected-workstation count,
// so its copy avoids server/office-offline language. Kept here (Electron-free)
// so it is unit-testable.
export function residentCopy(mode) {
  const isHost = mode === "host";
  return {
    trayTooltip: isHost ? "Otto Tracker — office server" : "Otto Tracker",
    trayStatusLabel: isHost ? "Otto server is running" : "Otto is connected to the office",
    trayQuitLabel: isHost ? "Quit Otto (take office offline)" : "Quit Otto",
    showWorkstationCount: isHost,
    hiddenNoticeBody: isHost
      ? "Workstations stay connected. Click the Otto icon in the menu bar / taskbar to reopen this window."
      : "Otto stays running. Click the Otto icon in the taskbar / menu bar to reopen this window.",
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd otto-job-tracker && npm run test:always-on-host`
Expected: PASS.

---

### Task 3: Make resident behavior apply to clients (gates + login item + dock)

**Files:**
- Modify: `desktop/main.js` — import; `_reconcileLoginItem`; startup `createTray` gate; `window-all-closed`; `_handleMainWindowClose`; `_showMainWindow`

**Interfaces:**
- Consumes: `isResidentApp` (Task 1).

- [ ] **Step 1: Extend the always-on import**

In `desktop/main.js`, replace:

```js
import { isAlwaysOnHostCapable, isAlwaysOnHostActive, shouldStartHostServer } from "./lib/always-on.js";
```

with:

```js
import { isAlwaysOnHostCapable, isAlwaysOnHostActive, shouldStartHostServer, isResidentApp, residentToggleField, residentCopy } from "./lib/always-on.js";
```

- [ ] **Step 2: Login item — gate on resident, keep `openAsHidden` host-only**

In `_reconcileLoginItem`, replace:

```js
  const shouldOpenAtLogin = isAlwaysOnHostActive(config);
  try {
    const current = app.getLoginItemSettings();
    if (current.openAtLogin !== shouldOpenAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: shouldOpenAtLogin,
        openAsHidden: process.platform === "darwin",
      });
    }
```

with:

```js
  const shouldOpenAtLogin = isResidentApp(config);
  try {
    const current = app.getLoginItemSettings();
    if (current.openAtLogin !== shouldOpenAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: shouldOpenAtLogin,
        // Hosts launch hidden (back-office server); clients launch visibly so
        // the user sees their workspace after reboot. openAsHidden is darwin-only.
        openAsHidden: config.mode === "host" && process.platform === "darwin",
      });
    }
```

- [ ] **Step 3: Startup tray gate — resident, not host-only**

Replace:

```js
  _reconcileLoginItem(config);
  if (isAlwaysOnHostActive(config)) {
    createTray();
  }
```

with:

```js
  _reconcileLoginItem(config);
  if (isResidentApp(config)) {
    createTray();
  }
```

- [ ] **Step 4: `window-all-closed` — stay alive when resident**

In the `window-all-closed` handler, replace:

```js
    if (!app.__ottoQuitting && isAlwaysOnHostActive(_readConfig())) return;
```

with:

```js
    if (!app.__ottoQuitting && isResidentApp(_readConfig())) return;
```

- [ ] **Step 5: `_handleMainWindowClose` — resident gate + host-only dock hide**

Replace the whole function body from the `let active` block through the dock line. Replace:

```js
function _handleMainWindowClose(event, win) {
  if (app.__ottoQuitting) return false; // a real quit is in progress
  let active = false;
  try {
    active = isAlwaysOnHostActive(_readConfig());
  } catch {
    active = false;
  }
  if (!active) return false;
  // No tray means no way to reopen — never trap the user behind a hidden
  // window; fall back to a normal close instead.
  if (!tray) return false;
  event.preventDefault();
  win.hide();
  if (process.platform === "darwin") app.dock?.hide?.();
  _updateTrayMenu();
  _maybeShowHiddenToTrayNotice();
  return true;
}
```

with:

```js
function _handleMainWindowClose(event, win) {
  if (app.__ottoQuitting) return false; // a real quit is in progress
  let config;
  try {
    config = _readConfig();
  } catch {
    return false;
  }
  if (!isResidentApp(config)) return false;
  // No tray means no way to reopen — never trap the user behind a hidden
  // window; fall back to a normal close instead.
  if (!tray) return false;
  event.preventDefault();
  win.hide();
  // Only a back-office HOST hides from the Dock; a client is user-facing and
  // stays in the Dock / Cmd-Tab.
  if (process.platform === "darwin" && config.mode === "host") app.dock?.hide?.();
  _updateTrayMenu();
  _maybeShowHiddenToTrayNotice();
  return true;
}
```

- [ ] **Step 6: `_showMainWindow` — host-only dock show**

Replace:

```js
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    if (process.platform === "darwin") app.dock?.show?.();
    mainWindow.focus();
    return;
  }
```

with:

```js
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    if (process.platform === "darwin") {
      let isHost = false;
      try { isHost = _readConfig().mode === "host"; } catch { /* default false */ }
      if (isHost) app.dock?.show?.();
    }
    mainWindow.focus();
    return;
  }
```

- [ ] **Step 7: Verify syntax and full suite**

Run: `cd otto-job-tracker && node --check desktop/main.js && node --check desktop/lib/always-on.js && npm run test:all`
Expected: `node --check` silent (exit 0); `npm run test:all` green (exit 0).

---

### Task 4: Client-aware tray, tooltip, and hide-to-tray notice copy

**Files:**
- Modify: `desktop/main.js` — `_updateTrayMenu`, `createTray` tooltip, `_maybeShowHiddenToTrayNotice`

**Interfaces:**
- Consumes: `residentCopy` (Task 2).

- [ ] **Step 1: `_updateTrayMenu` — branch copy + count by mode**

Replace the whole function:

```js
function _updateTrayMenu() {
  if (!tray) return;
  let count = 0;
  try {
    const getCount = globalThis.__ottoGetConnectedClientCount;
    if (typeof getCount === "function") count = getCount();
  } catch {
    count = 0;
  }
  const status = `${count} workstation${count !== 1 ? "s" : ""} connected`;
  const menu = Menu.buildFromTemplate([
    { label: "Open Otto", click: () => _showMainWindow() },
    { type: "separator" },
    { label: "Otto server is running", enabled: false },
    { label: status, enabled: false },
    { type: "separator" },
    { label: "Quit Otto (take office offline)", click: () => _quitFromTray() },
  ]);
  tray.setContextMenu(menu);
}
```

with:

```js
function _updateTrayMenu() {
  if (!tray) return;
  let mode = "host";
  try { mode = _readConfig().mode || "host"; } catch { /* default host */ }
  const copy = residentCopy(mode);
  const items = [
    { label: "Open Otto", click: () => _showMainWindow() },
    { type: "separator" },
    { label: copy.trayStatusLabel, enabled: false },
  ];
  if (copy.showWorkstationCount) {
    let count = 0;
    try {
      const getCount = globalThis.__ottoGetConnectedClientCount;
      if (typeof getCount === "function") count = getCount();
    } catch {
      count = 0;
    }
    items.push({ label: `${count} workstation${count !== 1 ? "s" : ""} connected`, enabled: false });
  }
  items.push({ type: "separator" });
  items.push({ label: copy.trayQuitLabel, click: () => _quitFromTray() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
```

- [ ] **Step 2: `createTray` — mode-aware tooltip**

Replace:

```js
    tray = new Tray(image);
    tray.setToolTip("Otto Tracker — office server");
    _updateTrayMenu();
```

with:

```js
    tray = new Tray(image);
    let trayMode = "host";
    try { trayMode = _readConfig().mode || "host"; } catch { /* default host */ }
    tray.setToolTip(residentCopy(trayMode).trayTooltip);
    _updateTrayMenu();
```

- [ ] **Step 3: `_maybeShowHiddenToTrayNotice` — mode-aware body**

Replace:

```js
    if (Notification.isSupported && !Notification.isSupported()) return;
    new Notification({
      title: "Otto is still running",
      body: "Workstations stay connected. Click the Otto icon in the menu bar / taskbar to reopen this window.",
    }).show();
```

with:

```js
    if (Notification.isSupported && !Notification.isSupported()) return;
    let noticeMode = "host";
    try { noticeMode = _readConfig().mode || "host"; } catch { /* default host */ }
    new Notification({
      title: "Otto is still running",
      body: residentCopy(noticeMode).hiddenNoticeBody,
    }).show();
```

- [ ] **Step 4: Verify**

Run: `cd otto-job-tracker && node --check desktop/main.js && npm run test:all`
Expected: exit 0; suite green.

---

### Task 5: Generalize the opt-out toggle to both modes (+ trap fix)

**Files:**
- Modify: `desktop/main.js` — rename `_toggleAlwaysOnHost` → `_toggleResidentMode`, branch field by mode, show-before-destroy-tray; `_setAppMenu` deps
- Modify: `desktop/lib/menu.js` — show the checkbox for both modes; rename props

**Interfaces:**
- Consumes: `isResidentApp` (Task 1), `residentToggleField` (Task 2).
- Produces (to menu.js): props `alwaysOnHostCapable` (unchanged), `residentEnabled`, `toggleResidentMode`.

- [ ] **Step 1: Replace `_toggleAlwaysOnHost` with `_toggleResidentMode`**

Replace:

```js
// Host menu toggle: flip this machine's always-on preference and apply it live.
function _toggleAlwaysOnHost() {
  try {
    const config = _readConfig();
    const next = !isAlwaysOnHostActive(config);
    config.alwaysOnHost = next;
    _writeConfig(config);
    _reconcileLoginItem(config);
    if (next) {
      createTray();
    } else {
      _destroyTray();
    }
    _setAppMenu(config);
  } catch (error) {
    _logStartup("Failed to toggle always-on host", error);
  }
}
```

with:

```js
// Menu toggle: flip THIS machine's resident preference (host or client) and
// apply it live. Writes the per-mode opt-out field so a client toggle never
// touches host semantics.
function _toggleResidentMode() {
  try {
    const config = _readConfig();
    const next = !isResidentApp(config);
    config[residentToggleField(config.mode)] = next;
    _writeConfig(config);
    _reconcileLoginItem(config);
    if (next) {
      createTray();
    } else {
      // Turning resident OFF: if the window is hidden to tray, bring it back
      // BEFORE destroying the tray, or the user is stranded with no way to
      // reopen (no tray, hidden window — true on Windows with no Dock fallback).
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
        if (process.platform === "darwin" && config.mode === "host") app.dock?.show?.();
        mainWindow.focus();
      }
      _destroyTray();
    }
    _setAppMenu(config);
  } catch (error) {
    _logStartup("Failed to toggle resident mode", error);
  }
}
```

- [ ] **Step 2: Update `_setAppMenu` deps**

In `_setAppMenu`, replace:

```js
    alwaysOnHostCapable: isAlwaysOnHostCapable(),
    alwaysOnHostEnabled: isAlwaysOnHostActive(config),
    toggleAlwaysOnHost: _toggleAlwaysOnHost,
    showUnattendedHostGuide: _showUnattendedHostGuide,
```

with:

```js
    alwaysOnHostCapable: isAlwaysOnHostCapable(),
    residentEnabled: isResidentApp(config),
    toggleResidentMode: _toggleResidentMode,
    showUnattendedHostGuide: _showUnattendedHostGuide,
```

- [ ] **Step 3: Generalize the menu — checkbox for both modes, unattended host stays host-only**

In `desktop/lib/menu.js`, update the destructured params: replace `alwaysOnHostEnabled` with `residentEnabled` and `toggleAlwaysOnHost` with `toggleResidentMode` in the `setAppMenu` signature:

```js
export function setAppMenu(config, { app, shell, showHostAddresses, chooseNetworkBackupFolder, scheduleAutomaticBackups, runBackupToNetworkFolder, restoreDatabase, resetHost, repairLicense, createSetupWindow, showDiagnostics, exportSupportBundle, checkForUpdates, installUpdate, getUpdateState, alwaysOnHostCapable, residentEnabled, toggleResidentMode, showUnattendedHostGuide }) {
```

Then replace the host-only always-on block (currently inside the `isHost` array):

```js
              ...(alwaysOnHostCapable
                ? [
                    { type: "separator" },
                    {
                      label: "Keep Otto Running in the Background",
                      type: "checkbox",
                      checked: !!alwaysOnHostEnabled,
                      click: () => {
                        if (typeof toggleAlwaysOnHost === "function") toggleAlwaysOnHost();
                      },
                    },
                    {
                      label: "Set Up Unattended Host…",
                      click: () => {
                        if (typeof showUnattendedHostGuide === "function") showUnattendedHostGuide();
                      },
                    },
                  ]
                : []),
              { type: "separator" },
```

with (unattended-host stays host-only; the resident checkbox moves out to a shared block):

```js
              ...(alwaysOnHostCapable
                ? [
                    { type: "separator" },
                    {
                      label: "Set Up Unattended Host…",
                      click: () => {
                        if (typeof showUnattendedHostGuide === "function") showUnattendedHostGuide();
                      },
                    },
                  ]
                : []),
              { type: "separator" },
```

Then add the shared resident toggle just before the `{ label: "Change Connection…" }` item (which sits OUTSIDE the `isHost` array, so it shows for both modes):

```js
        ...(alwaysOnHostCapable
          ? [
              {
                label: "Keep Otto Running in the Background",
                type: "checkbox",
                checked: !!residentEnabled,
                click: () => {
                  if (typeof toggleResidentMode === "function") toggleResidentMode();
                },
              },
              { type: "separator" },
            ]
          : []),
        { label: "Change Connection…", click: () => createSetupWindow() },
```

- [ ] **Step 4: Verify**

Run: `cd otto-job-tracker && node --check desktop/main.js && node --check desktop/lib/menu.js && npm run test:all`
Expected: exit 0; suite green.

---

### Task 6: `second-instance` reopens a closed/hidden resident window

**Files:**
- Modify: `desktop/main.js` — `second-instance` handler

**Interfaces:**
- Consumes: `_showMainWindow` (existing; relaunches from config when the window was destroyed).

- [ ] **Step 1: Reopen instead of only focusing**

In the `app.on("second-instance", ...)` handler, replace:

```js
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
```

with:

```js
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Window was destroyed while the app stayed resident (e.g. a Windows client
    // closed to tray and the user relaunched the exe). Reopen it from config —
    // _showMainWindow handles the destroyed → relaunch path.
    _showMainWindow();
  }
```

- [ ] **Step 2: Verify**

Run: `cd otto-job-tracker && node --check desktop/main.js && npm run test:all`
Expected: exit 0; suite green.

---

### Task 7: Final verification, manual QA, single commit + push

**Files:** none (verification + git)

- [ ] **Step 1: Full automated verification**

Run:
```bash
cd otto-job-tracker
node --check desktop/main.js && node --check desktop/lib/always-on.js && node --check desktop/lib/menu.js
npm run test:all
```
Expected: `node --check` exit 0 for all three; `npm run test:all` green (exit 0), including the new `isResidentApp` / `residentToggleField` / `residentCopy` cases.

- [ ] **Step 2: Confirm no stray `isAlwaysOnHostActive` at resident sites**

Run: `cd otto-job-tracker && grep -n "isAlwaysOnHostActive" desktop/main.js`
Expected: only host-SERVER semantics remain — the `before-quit` shutdown-backup path and the "clients still connected" warning (`config.mode === "host"` context). The four resident sites (login item, startup tray gate, window-all-closed, `_handleMainWindowClose`) must now read `isResidentApp`.

- [ ] **Step 3: Manual QA checklist (login items / tray / reboot can't be unit-tested)**

Build and run a packaged build on each platform (resident behavior requires `app.isPackaged`). Walk:

*Windows client:*
- Reboot → Otto **auto-starts visibly**.
- Close the window → **hides to tray** (taskbar/notification-area icon present); app keeps running.
- Click the tray icon → window **reopens**; relaunch the exe while running → existing window reopens (no second instance).
- Open menu → "Keep Otto Running in the Background" is **checked**; uncheck **while the window is hidden** → window **returns** and tray disappears; re-check → tray returns, close hides again.
- Host down at launch → "Host is offline … read-only … reconnecting" overlay → **auto-recovers** when host returns.

*macOS host (regression):*
- Close → hides to menu-bar tray; reopen → instant (no rebuild, no "port in use").
- Auto-starts hidden at login; opt-out while hidden → window returns; Dock hides on hide-to-tray; quit warns when clients connected.

- [ ] **Step 4: Single commit + push**

Stage everything (the already-landed #1 reopen fix, the spec, the plan, and all client-parity changes) and push to `main`:

```bash
cd otto-job-tracker
git add -A
git status   # sanity-check the staged set
git commit -m "feat(desktop): client parity (tray + auto-start) + host reopen fix

- Fix host window reopen showing a false 'port in use' (shouldStartHostServer:
  skip the host bring-up when the embedded server is already running).
- Add isResidentApp so tray, close-to-tray, stay-alive, and auto-start cover
  clients too (default-on, per-machine opt-out via keepClientResident).
- Branch tray/tooltip/notice copy and the opt-out field by mode; show the
  hidden window before destroying the tray on opt-out; launch clients visibly;
  keep Dock-hide host-only; reopen a closed resident window on second-instance.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```
Expected: clean push to `main`. Report the commit SHA to the user.

---

## Self-Review (completed by plan author)

**Spec coverage:** §1 predicate → Task 1; §2 config/toggle/menu → Tasks 1,5; §3 trap fix → Task 5; §4 tray copy → Tasks 2,4; §5 auto-start visibility → Task 3; §6 dock + second-instance → Tasks 3,6; §7 out-of-scope → intentionally no tasks; §8 testing → Tasks 1,2 (unit) + Task 7 (manual). No gaps.

**Type consistency:** `isResidentApp(config, env)`, `residentToggleField(mode)`, `residentCopy(mode)` referenced identically in Tasks 1–6. Menu props `alwaysOnHostCapable` / `residentEnabled` / `toggleResidentMode` match between `_setAppMenu` (Task 5 Step 2) and the menu.js destructure (Task 5 Step 3). `residentCopy` keys (`trayTooltip`, `trayStatusLabel`, `trayQuitLabel`, `showWorkstationCount`, `hiddenNoticeBody`) match between definition (Task 2) and consumers (Task 4). No drift.

**Placeholder scan:** none — every code step shows complete before/after code and exact commands.
