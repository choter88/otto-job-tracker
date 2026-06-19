# Client Connection & Login UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the client blank-screen/no-reconnect bug, auto-logout on window close (host + client), and add an editable login-ID combobox fed by a public endpoint.

**Architecture:** A new local `offline.html` + a main-process reconnect controller replace the fragile "inject after 5 failures" path; `_showMainWindow` reloads on reopen. On hide, the main process ends the session (cookie/storage clear + a renderer `POST /api/logout` via a new `otto:auto-logout` IPC). A new public `GET /api/login-ids` feeds a native `<datalist>` combobox that polls ~45s. Pure logic (reconnect timing/online-detection, login-ID projection) is extracted and unit-tested.

**Tech Stack:** Electron (ESM main, CJS preload), React + @tanstack/react-query (renderer), Express + Drizzle (server), Node built-in test runner via `tsx`.

## Global Constraints

- **Stay on `main`. No per-task commits.** Review each task as its UNSTAGED diff, then stage it. ONE commit + push in the final task. (Per user instruction.)
- **Never edit `package.json` `version`.**
- **No offline outbox / offline writes.** Clients stay read-only when the host is down. This work only changes connection UX + session lifecycle.
- **Keep the 15-minute idle (rolling) session timeout unchanged** ([server/auth.ts:105](../../../server/auth.ts)).
- **Auto-logout on close applies to BOTH host and client.**
- **Pre-login endpoint exposes login IDs ONLY** — never names, PINs, or other user fields.
- **Verification per task:** `node --check` on every edited `.js`/`.cjs`; `npx tsc --noEmit` is NOT run per-task (large); rely on `npm run test:all` staying green + `node --check`. Tasks 1-2 and 6 add unit tests; wiring tasks verify via `node --check` + `npm run test:all` + the manual checklist in the final task. New tests must be wired into `package.json`'s `test:all` chain.

**Reference spec:** `docs/superpowers/specs/2026-06-19-client-connection-login-ux-design.md`

---

### Task 1: `reconnect.js` pure helpers (TDD)

**Files:**
- Create: `desktop/lib/reconnect.js`
- Create test: `tests/reconnect.test.ts`
- Modify: `package.json` (add `test:reconnect` and chain it into `test:all`)

**Interfaces:**
- Produces: `getReconnectDelay(attempt) => number` — backoff in ms, `2000 * 1.5^min(attempt,10)` capped at 15000.
- Produces: `isOnlineLoad(loadedUrl, targetUrl) => boolean` — true only if both parse and share an origin (an `offline.html` `file://` load returns false). Never throws.

- [ ] **Step 1: Write the failing test** — create `tests/reconnect.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { getReconnectDelay, isOnlineLoad } from "../desktop/lib/reconnect.js";

test("getReconnectDelay grows then caps at 15s", () => {
  assert.equal(getReconnectDelay(0), 2000);
  assert.equal(getReconnectDelay(1), 3000);
  assert.equal(getReconnectDelay(2), 4500);
  assert.equal(getReconnectDelay(100), 15000); // capped
});

test("isOnlineLoad is true only for the target app origin", () => {
  assert.equal(isOnlineLoad("https://192.168.1.5:5150/", "https://192.168.1.5:5150"), true);
  assert.equal(isOnlineLoad("https://192.168.1.5:5150/jobs", "https://192.168.1.5:5150/"), true);
  // the local offline page must NOT count as online (or the retry loop would stop)
  assert.equal(isOnlineLoad("file:///Applications/Otto.app/.../offline.html", "https://192.168.1.5:5150"), false);
  assert.equal(isOnlineLoad("https://other:5150/", "https://192.168.1.5:5150"), false);
});

test("isOnlineLoad never throws on garbage", () => {
  assert.equal(isOnlineLoad("", "https://x:5150"), false);
  assert.equal(isOnlineLoad("not a url", "also not"), false);
  assert.equal(isOnlineLoad(null, undefined), false);
});
```

- [ ] **Step 2: Add the npm script** — in `package.json`, add to `scripts` after `test:always-on`:

```json
    "test:reconnect": "node --import tsx --test tests/reconnect.test.ts",
```

and append ` && npm run test:reconnect` to the end of the `test:all` value.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd otto-job-tracker && npm run test:reconnect`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 4: Implement `desktop/lib/reconnect.js`**

```js
// Electron-free pure logic for the client reconnect controller, so the timing
// and the "are we actually back online?" decision are unit-testable.

// Exponential backoff (ms) between reconnect attempts, capped at 15s.
export function getReconnectDelay(attempt) {
  const n = Math.min(Number(attempt) || 0, 10);
  return Math.min(15000, 2000 * Math.pow(1.5, n));
}

// A load only counts as "online" when the TARGET app origin loaded. The local
// offline.html (a file:// URL) must return false, or a finished offline-page
// load would wrongly stop the retry loop and strand the user.
export function isOnlineLoad(loadedUrl, targetUrl) {
  try {
    return new URL(loadedUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd otto-job-tracker && npm run test:reconnect`
Expected: PASS.

---

### Task 2: `login-ids` server projection (TDD)

**Files:**
- Create: `server/login-ids.ts`
- Create test: `tests/login-ids.test.ts`
- Modify: `package.json` (add `test:login-ids`, chain into `test:all`)

**Interfaces:**
- Produces: `toLoginIds(users) => string[]` — maps an array of user-like objects to their `loginId`s only: drops empty/missing, dedupes, sorts case-insensitively. Exposes NOTHING but login IDs.

- [ ] **Step 1: Write the failing test** — `tests/login-ids.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { toLoginIds } from "../server/login-ids.ts";

test("toLoginIds returns only login IDs, deduped and sorted", () => {
  const users = [
    { loginId: "zoe", firstName: "Zoe", pinHash: "secret" },
    { loginId: "amy", firstName: "Amy", pinHash: "secret" },
    { loginId: "amy", firstName: "Amy2" },
  ];
  assert.deepEqual(toLoginIds(users), ["amy", "zoe"]);
});

test("toLoginIds drops empty/missing and never leaks other fields", () => {
  const out = toLoginIds([{ loginId: "" }, { loginId: null }, {}, { loginId: "bob" }]);
  assert.deepEqual(out, ["bob"]);
  assert.equal(out.every((v) => typeof v === "string"), true);
});

test("toLoginIds tolerates bad input", () => {
  assert.deepEqual(toLoginIds(undefined), []);
  assert.deepEqual(toLoginIds(null), []);
  assert.deepEqual(toLoginIds([]), []);
});
```

- [ ] **Step 2: Add the npm script** — in `package.json`, add after `test:reconnect`:

```json
    "test:login-ids": "node --import tsx --test tests/login-ids.test.ts",
```

and append ` && npm run test:login-ids` to `test:all`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd otto-job-tracker && npm run test:login-ids`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `server/login-ids.ts`** (no db imports — keep it pure):

```ts
// Pure projection of office users to their login IDs ONLY. Used by the public
// pre-login endpoint, so it must never surface names, PINs, or any other field.
export function toLoginIds(users: ReadonlyArray<{ loginId?: string | null }> | null | undefined): string[] {
  if (!Array.isArray(users)) return [];
  const seen = new Set<string>();
  for (const u of users) {
    const id = typeof u?.loginId === "string" ? u.loginId.trim() : "";
    if (id) seen.add(id);
  }
  return Array.from(seen).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd otto-job-tracker && npm run test:login-ids`
Expected: PASS.

---

### Task 3: Preload — `onAutoLogout` + `reconnectNow`

**Files:**
- Modify: `desktop/preload.cjs`

**Interfaces:**
- Produces (to renderer): `window.otto.onAutoLogout(callback) => unsubscribe` — subscribes to the main→renderer `otto:auto-logout` push.
- Produces (to offline page): `window.otto.reconnectNow() => Promise` — invoke `otto:reconnect:now`.

- [ ] **Step 1: Add both bridge methods** — in `desktop/preload.cjs`, insert immediately before the closing `});` (after the `onOrderSheetsEvent` block, line ~56):

```js
  // Immediate reconnect, used by the offline page's "Try now" button.
  reconnectNow: () => ipcRenderer.invoke("otto:reconnect:now"),
  // Main → renderer push: the window was hidden, so end the session.
  // Returns an unsubscribe function for React effect cleanup.
  onAutoLogout: (callback) => {
    const listener = () => {
      try {
        callback();
      } catch {
        // never let a renderer callback error break the IPC listener
      }
    };
    ipcRenderer.on("otto:auto-logout", listener);
    return () => ipcRenderer.removeListener("otto:auto-logout", listener);
  },
```

- [ ] **Step 2: Verify**

Run: `cd otto-job-tracker && node --check desktop/preload.cjs`
Expected: exit 0.

---

### Task 4: Main process — reconnect IPC, auto-logout on hide, reload on reopen

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: `_getTargetUrlForConfig`, `_readConfig`, `mainWindow`, `ipcMain`, `BrowserWindow` (all existing in `main.js`).

- [ ] **Step 1: Add the `otto:reconnect:now` IPC handler.** Find where other `ipcMain.handle("otto:...")` handlers are registered (search `ipcMain.handle`). Add this handler alongside them:

```js
  ipcMain.handle("otto:reconnect:now", (event) => {
    try {
      const w = BrowserWindow.fromWebContents(event.sender);
      if (w && !w.isDestroyed()) {
        w.loadURL(_getTargetUrlForConfig(_readConfig()), { extraHeaders: "pragma: no-cache\n" });
      }
    } catch (error) {
      _logStartup("reconnect:now failed", error);
    }
    return { ok: true };
  });
```

- [ ] **Step 2: Auto-logout on hide** — in `_handleMainWindowClose`, replace:

```js
  event.preventDefault();
  win.hide();
  // Only a back-office HOST hides from the Dock; a client is user-facing and
  // stays in the Dock / Cmd-Tab.
  if (process.platform === "darwin" && config.mode === "host") app.dock?.hide?.();
  _updateTrayMenu();
  _maybeShowHiddenToTrayNotice();
  return true;
```

with:

```js
  event.preventDefault();
  win.hide();
  // Only a back-office HOST hides from the Dock; a client is user-facing and
  // stays in the Dock / Cmd-Tab.
  if (process.platform === "darwin" && config.mode === "host") app.dock?.hide?.();
  // HIPAA: end the session on hide so reopening requires re-login (shared
  // machines). Ask the renderer to POST /api/logout (server invalidation +
  // audit) while it still has its cookie, then clear the partition's auth
  // state as a backstop in case the renderer is unresponsive/offline.
  try { win.webContents.send("otto:auto-logout"); } catch { /* best-effort */ }
  try {
    const ses = win.webContents.session;
    setTimeout(() => {
      try { ses.clearStorageData({ storages: ["cookies", "localStorage", "sessionStorage"] }); } catch { /* best-effort */ }
    }, 1500);
  } catch { /* best-effort */ }
  _updateTrayMenu();
  _maybeShowHiddenToTrayNotice();
  return true;
```

- [ ] **Step 3: Reload on reopen** — in `_showMainWindow`, replace:

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

with:

```js
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    // Reopen always reloads: after auto-logout this lands on a fresh login, and
    // it recovers a stale/offline renderer that closing-to-tray left behind.
    try { mainWindow.loadURL(_getTargetUrlForConfig(_readConfig()), { extraHeaders: "pragma: no-cache\n" }); } catch { /* ignore */ }
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

- [ ] **Step 4: Verify**

Run: `cd otto-job-tracker && node --check desktop/main.js && npm run test:all`
Expected: `node --check` exit 0; suite green.

---

### Task 5: Offline page + reconnect controller

**Files:**
- Create: `desktop/assets/offline.html`
- Modify: `desktop/lib/windows.js`

**Interfaces:**
- Consumes: `getReconnectDelay`, `isOnlineLoad` (Task 1); `window.otto.reconnectNow` (Task 3); `otto:reconnect:now` handler (Task 4).

- [ ] **Step 1: Create `desktop/assets/offline.html`** (self-contained; uses the preload bridge if present):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
    <title>Otto — reconnecting</title>
    <style>
      html, body { margin: 0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: system-ui, sans-serif; background: #f8fafc; color: #374151; text-align: center; padding: 2rem; box-sizing: border-box; }
      h2 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { font-size: 0.875rem; color: #6b7280; margin: 0.25rem 0; }
      .muted { font-size: 0.75rem; color: #9ca3af; margin-top: 0.75rem; }
      button { margin-top: 1.25rem; padding: 0.5rem 1.5rem; background: #2563eb; color: #fff;
        border: none; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    </style>
  </head>
  <body>
    <div>
      <h2>Can't reach the office server</h2>
      <p>Otto is read-only until it's opened back up on the main computer.</p>
      <p class="muted">Reconnecting automatically…</p>
      <button id="retry" type="button">Try now</button>
    </div>
    <script>
      document.getElementById("retry").addEventListener("click", function () {
        try { if (window.otto && window.otto.reconnectNow) window.otto.reconnectNow(); } catch (e) {}
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Replace the reconnect block in `windows.js`.** First add the import at the top of `desktop/lib/windows.js` (with the other imports):

```js
import { getReconnectDelay, isOnlineLoad } from "./reconnect.js";
```

Then replace the entire block from `// Auto-reconnect with exponential backoff.` (line ~213) through the `win.loadURL(targetUrl);` call (line ~289) — i.e. the old `loadFailCount`/`getBackoffDelay`/`did-fail-load`/`did-finish-load` handlers AND the bare `win.loadURL(targetUrl)` — with:

```js
  // Connection controller. Load the app; on a main-frame failure show a local
  // offline page (always renders — no blank) and keep retrying with backoff.
  // Only a successful load of the TARGET origin counts as "online" — a finished
  // offline-page load must NOT stop the loop (see isOnlineLoad).
  let loadFailCount = 0;
  let reconnectTimer = null;
  const offlinePath = path.join(dirName, "assets", "offline.html");

  function loadApp() {
    if (win.isDestroyed()) return;
    try { win.loadURL(targetUrl, { extraHeaders: "pragma: no-cache\n" }); } catch { /* ignore */ }
  }
  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { if (!win.isDestroyed()) loadApp(); }, getReconnectDelay(loadFailCount));
  }

  win.webContents.on(
    "did-fail-load",
    async (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || win.isDestroyed()) return;
      loadFailCount++;

      // Host: after a few failures the embedded server is likely genuinely
      // broken — keep the existing Retry / Close dialog.
      if (config.mode === "host" && loadFailCount >= 3) {
        const { dialog } = await import("electron");
        const { response } = await dialog.showMessageBox(win, {
          type: "error",
          buttons: ["Retry", "Close"],
          defaultId: 0,
          cancelId: 1,
          message: "Otto is still starting up",
          detail: "This may take a moment. Click Retry to try again.",
        }).catch(() => ({ response: 0 }));
        if (win.isDestroyed()) return;
        if (response === 0) { loadFailCount = 0; loadApp(); } else { try { win.close(); } catch { /* ignore */ } }
        return;
      }

      // Client: show the local offline page immediately (only if not already
      // on it — a failed loadURL leaves the last committed page in place, so
      // we avoid re-navigating and flickering every retry), then schedule a retry.
      try {
        const cur = win.webContents.getURL() || "";
        if (!cur.startsWith("file:") && !win.isDestroyed()) win.loadFile(offlinePath);
      } catch { /* ignore */ }
      scheduleReconnect();
    },
  );

  win.webContents.on("did-finish-load", () => {
    // Back online ONLY when the real app origin loaded; an offline-page load
    // (file://) must not reset the counter or clear the retry timer.
    let online = false;
    try { online = isOnlineLoad(win.webContents.getURL(), targetUrl); } catch { online = false; }
    if (online) {
      loadFailCount = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }
  });

  registerTlsTrustForWindow(win, targetUrl, config);
  loadApp();
```

(The `setupNoInternetNetworkGuard(...)`, `injectCspOnSession(...)`, and `return win;` lines that followed the old `win.loadURL` stay exactly as they were, immediately after this block.)

- [ ] **Step 3: Verify**

Run: `cd otto-job-tracker && node --check desktop/lib/windows.js && node --check desktop/lib/reconnect.js && npm run test:all`
Expected: exit 0; suite green. (`offline.html` ships via the existing `desktop/**` packaging glob — no build change.)

---

### Task 6: Public `GET /api/login-ids` endpoint

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `toLoginIds` (Task 2), `storage.getAllOffices()`, `storage.getUsersInOffice(officeId)` (existing).
- Produces: `GET /api/login-ids` (no auth, rate-limited) → `{ loginIds: string[] }`.

- [ ] **Step 1: Import the projection.** Near the top of `server/routes.ts` (with the other local imports), add:

```ts
import { toLoginIds } from "./login-ids";
```

- [ ] **Step 2: Add the public endpoint.** Immediately after the `app.get("/api/setup/status", ...)` handler (ends ~line 1208), add:

```ts
  // Public, pre-auth: login IDs for the host's office, to populate the login
  // dropdown. Exposes login IDs ONLY (no names/PINs). LAN-only app; lightly
  // rate-limited per IP to discourage scraping.
  const loginIdHits = new Map<string, { count: number; resetAt: number }>();
  app.get("/api/login-ids", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const slot = loginIdHits.get(ip);
      if (!slot || now > slot.resetAt) {
        loginIdHits.set(ip, { count: 1, resetAt: now + 60_000 });
      } else if (slot.count >= 60) {
        return res.status(429).json({ loginIds: [] });
      } else {
        slot.count++;
      }

      const offices = await storage.getAllOffices();
      const office = offices[0];
      if (!office) return res.json({ loginIds: [] });
      const users = await storage.getUsersInOffice(office.id);
      return res.json({ loginIds: toLoginIds(users) });
    } catch {
      return res.json({ loginIds: [] }); // non-fatal: the login screen falls back to a text field
    }
  });
```

- [ ] **Step 3: Verify**

Run: `cd otto-job-tracker && npm run test:all`
Expected: green. (No `node --check` for `.ts`; the projection is unit-tested in Task 2 and the route reuses existing storage methods.)

---

### Task 7: Renderer — auto-logout effect + login-ID combobox

**Files:**
- Modify: `client/src/hooks/use-auth.tsx` (auto-logout effect)
- Create: `client/src/hooks/use-login-ids.tsx` (fetch + poll)
- Modify: `client/src/pages/auth-page.tsx` (datalist combobox)

**Interfaces:**
- Consumes: `window.otto.onAutoLogout` (Task 3); `GET /api/login-ids` (Task 6).

- [ ] **Step 1: Auto-logout effect** — in `client/src/hooks/use-auth.tsx`, ensure `useEffect` is imported from `react`, then add this effect inside `AuthProvider` (just before the `return (` that renders `<AuthContext.Provider>`). Reference `logoutMutation` defined above it:

```tsx
  // The Electron main process clears the window's session and fires this when
  // the window is hidden to tray (HIPAA: shared machines). POST the logout so
  // the server invalidates the session and records it.
  useEffect(() => {
    const otto = (window as any).otto;
    if (!otto?.onAutoLogout) return;
    const unsubscribe = otto.onAutoLogout(() => {
      try { logoutMutation.mutate(); } catch { /* best-effort */ }
    });
    return () => { try { unsubscribe?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 2: Create `client/src/hooks/use-login-ids.tsx`**:

```tsx
import { useQuery } from "@tanstack/react-query";

// Approved login IDs for the office, for the pre-login dropdown. Refreshes
// every 45s while the login screen is mounted. Non-fatal on failure — callers
// fall back to a plain text field.
export function useLoginIds(): string[] {
  const { data } = useQuery<string[]>({
    queryKey: ["/api/login-ids"],
    queryFn: async () => {
      const res = await fetch("/api/login-ids", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.loginIds) ? json.loginIds : [];
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: false,
  });
  return data ?? [];
}
```

- [ ] **Step 3: Wire the datalist into the login form** — in `client/src/pages/auth-page.tsx`:

(a) add the import near the other hook imports:

```tsx
import { useLoginIds } from "@/hooks/use-login-ids";
```

(b) call the hook inside the `AuthPage` component (near the other hook calls, e.g. just after the `pinLoginForm` is set up):

```tsx
  const loginIds = useLoginIds();
```

(c) replace the Login ID input block:

```tsx
                            <Input
                              id="pin-login-id"
                              type="text"
                              autoCapitalize="none"
                              autoCorrect="off"
                              placeholder="jane.cho"
                              {...pinLoginForm.register("loginId")}
                              data-testid="input-pin-login-id"
                            />
```

with (adds `list=` + a `<datalist>` of approved IDs; still a normal text field, so a not-yet-listed user can type):

```tsx
                            <Input
                              id="pin-login-id"
                              type="text"
                              list="otto-login-ids"
                              autoCapitalize="none"
                              autoCorrect="off"
                              placeholder="jane.cho"
                              {...pinLoginForm.register("loginId")}
                              data-testid="input-pin-login-id"
                            />
                            <datalist id="otto-login-ids">
                              {loginIds.map((id) => (
                                <option key={id} value={id} />
                              ))}
                            </datalist>
```

- [ ] **Step 4: Verify**

Run: `cd otto-job-tracker && npm run lint && npm run test:all`
Expected: `eslint client` passes (the new hook obeys hooks rules); suite green. (If `npm run lint` flags the `exhaustive-deps` line, confirm the disable comment is present.)

---

### Task 8: Final verification, manual QA, single commit + push

**Files:** none (verification + git)

- [ ] **Step 1: Full automated verification**

```bash
cd otto-job-tracker
node --check desktop/main.js && node --check desktop/lib/windows.js && node --check desktop/lib/reconnect.js && node --check desktop/preload.cjs
npm run lint
npm run test:all
```
Expected: all `node --check` exit 0; `lint` clean; `test:all` green (incl. `test:reconnect` + `test:login-ids`).

- [ ] **Step 2: Confirm the offline page ships and no fragile pattern remains**

```bash
cd otto-job-tracker
test -f desktop/assets/offline.html && echo "offline.html present"
grep -n "loadFailCount === 5" desktop/lib/windows.js && echo "STALE pattern still present (FAIL)" || echo "old 5th-failure injection gone (good)"
```

- [ ] **Step 3: Manual QA (Electron + server, packaged or `npm run desktop` against a built client)**
- *Offline (A):* start a **client** with the **host down** → the offline page shows immediately (not blank); start the host → client **auto-reconnects** within ≤15s; while down, close+reopen → still the offline page (not stuck blank); after host up, close+reopen → loads the app.
- *Auto-logout (B):* log in on a **client**; close the window (hides to tray); reopen → **login screen** (logged out). Repeat on the **host**. Confirm a `POST /api/logout` reached the server (audit) when the renderer was live.
- *Combobox (C):* login screen shows the login-ID field with a dropdown of approved IDs; selecting fills it; typing a not-listed ID still works; add/remove an office user → list updates within ~45s; stop the server → field still usable (empty list, no crash).

- [ ] **Step 4: Single commit + push** (exclude the pre-existing unrelated `docs/RELEASE-CHECKLIST.md`):

```bash
cd otto-job-tracker
git add desktop server client tests package.json docs/superpowers
git status   # confirm RELEASE-CHECKLIST.md is NOT staged
git commit -m "feat: client offline page + auto-reconnect, auto-logout on close, login-ID dropdown

- Replace the blank-on-host-down path with a local offline page + a
  main-process reconnect controller; reload on reopen so close/reopen recovers.
- Auto-logout (host + client) when the window hides to tray: renderer POSTs
  /api/logout (audit) + main clears the partition session as a backstop.
- Add public, rate-limited GET /api/login-ids feeding a login-ID datalist
  combobox on the login screen (login IDs only; polls ~45s).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin HEAD
```
Report the commit SHA.

---

## Self-Review (completed by plan author)

**Spec coverage:** A offline page + reconnect → Tasks 1,5; reload-on-reopen → Task 4; cache-bust → Tasks 4,5. B auto-logout (both modes) → Tasks 3,4,7; 15-min timeout untouched (no task touches auth.ts timeout). C public endpoint → Tasks 2,6; combobox + poll → Task 7; login-IDs-only → Tasks 2,6. Out-of-scope items have no tasks. Testing → Tasks 1,2 (unit) + Task 8 (lint + manual). No gaps.

**Type consistency:** `getReconnectDelay`/`isOnlineLoad` (Task 1) consumed in Task 5 with matching signatures; `toLoginIds` (Task 2) consumed in Task 6; `onAutoLogout`/`reconnectNow` (Task 3) consumed by Tasks 4 (`otto:reconnect:now` handler), 5 (offline.html), 7 (effect); `/api/login-ids` shape `{ loginIds: string[] }` consistent between Task 6 (producer) and Task 7 hook (consumer).

**Placeholder scan:** none — every code step is complete. The `offline.html` step carries an explicit transcription-guard note to strip the stray `why:` token and use the stated valid `body` rule.
