import path from "path";
import { BrowserWindow, Menu, screen } from "electron";
import { getReconnectDelay, isOnlineLoad, cspAllowsInline } from "./reconnect.js";

/**
 * In a packaged build, DevTools are disabled by default. Open them when:
 *   1. The env var OTTO_DEVTOOLS=1 is set when launching the app
 *   2. The app is launched with --devtools as a CLI arg
 *   3. The app is unpacked (npm run desktop, npm run pack:desktop)
 *
 * Usage from a packaged .app on macOS:
 *   OTTO_DEVTOOLS=1 open -a "Otto Tracker"
 * or:
 *   "/Applications/Otto Tracker.app/Contents/MacOS/Otto Tracker" --devtools
 *
 * A keyboard shortcut (Cmd+Option+I / Ctrl+Shift+I) also toggles DevTools at any time.
 */
function shouldOpenDevTools() {
  if (process.env.OTTO_DEVTOOLS === "1") return true;
  if (process.argv.includes("--devtools")) return true;
  return false;
}

function attachDevToolsShortcut(win) {
  // Cmd+Option+I on macOS, Ctrl+Shift+I elsewhere — both toggle DevTools.
  win.webContents.on("before-input-event", (event, input) => {
    const isMac = process.platform === "darwin";
    const modPressed = isMac ? input.meta && input.alt : input.control && input.shift;
    if (modPressed && (input.key === "I" || input.key === "i")) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function maybeOpenDevTools(win) {
  if (shouldOpenDevTools()) {
    // `detach` opens DevTools in a separate window so it doesn't crowd the
    // app — easier to read stack traces while clicking around.
    win.webContents.openDevTools({ mode: "detach" });
  }
  attachDevToolsShortcut(win);
}

// Defense-in-depth CSP injection via Electron session (F-03).
// This ensures CSP is enforced even if the Express server header is bypassed.
//
// Two policies: one for the main app (served by Express, no inline scripts)
// and one for standalone HTML files (setup.html, boot.html) that use inline scripts.
const CSP_APP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self' wss:; frame-ancestors 'none'; object-src 'none';";

const CSP_LOCAL_HTML =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self' wss:; frame-ancestors 'none'; object-src 'none';";

function injectCspOnSession(ses, { allowInlineScripts = false } = {}) {
  if (!ses || ses.__ottoCspInjected) return;
  ses.__ottoCspInjected = true;
  ses.webRequest.onHeadersReceived((details, callback) => {
    // Per-request: local packaged HTML (offline.html, loaded via file://) needs
    // its inline <script> to run; the app (https) keeps the strict policy. The
    // main client window shares one session for both, so we can't pick once.
    const policy = cspAllowsInline(details.url, allowInlineScripts) ? CSP_LOCAL_HTML : CSP_APP;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

const MAIN_WINDOW_BASE_WIDTH = 1500;
const MAIN_WINDOW_BASE_HEIGHT = 864;
const MAIN_WINDOW_BASE_MIN_WIDTH = 1320;
const MAIN_WINDOW_BASE_MIN_HEIGHT = 864;

export function getDisplayWorkAreaForBounds(bounds) {
  try {
    if (bounds) {
      return screen.getDisplayMatching(bounds)?.workAreaSize || null;
    }
    return screen.getPrimaryDisplay()?.workAreaSize || null;
  } catch {
    return null;
  }
}

export function getMainWindowBaselineSize() {
  const workArea = getDisplayWorkAreaForBounds();
  const displayWidth = Number(workArea?.width) || MAIN_WINDOW_BASE_WIDTH;
  const displayHeight = Number(workArea?.height) || MAIN_WINDOW_BASE_HEIGHT;

  const minWidth = Math.min(MAIN_WINDOW_BASE_MIN_WIDTH, displayWidth);
  const minHeight = Math.min(MAIN_WINDOW_BASE_MIN_HEIGHT, displayHeight);
  const width = Math.max(minWidth, Math.min(MAIN_WINDOW_BASE_WIDTH, displayWidth));
  const height = Math.max(minHeight, Math.min(MAIN_WINDOW_BASE_HEIGHT, displayHeight));

  return { width, height, minWidth, minHeight };
}

export function setMainWindowMinWidth(win, widthInput) {
  if (!win || win.isDestroyed()) {
    return { ok: false, message: "Main window is not available." };
  }

  const workArea = getDisplayWorkAreaForBounds(win.getBounds());
  const displayWidth = Number(workArea?.width) || MAIN_WINDOW_BASE_WIDTH;
  const currentBounds = win.getBounds();
  const currentMinSize = win.getMinimumSize();

  const baselineMinWidth = Math.min(MAIN_WINDOW_BASE_MIN_WIDTH, displayWidth);
  const requestedWidth = Math.round(Number(widthInput));
  const safeRequestedWidth = Number.isFinite(requestedWidth) ? requestedWidth : baselineMinWidth;
  const nextMinWidth = Math.min(displayWidth, Math.max(baselineMinWidth, safeRequestedWidth));
  const displayHeight = Number(workArea?.height) || MAIN_WINDOW_BASE_HEIGHT;
  const baselineMinHeight = Math.min(MAIN_WINDOW_BASE_MIN_HEIGHT, displayHeight);
  const minHeight = Math.max(Number(currentMinSize?.[1]) || 0, baselineMinHeight);

  win.setMinimumSize(nextMinWidth, minHeight);

  if (currentBounds.width < nextMinWidth) {
    const nextWidth = Math.min(displayWidth, nextMinWidth);
    win.setBounds({
      ...currentBounds,
      width: nextWidth,
    });
  }

  return { ok: true, minWidth: nextMinWidth, maxWidth: displayWidth };
}

export function createWindow(targetUrl, config, { __dirname: dirName, APP_DISPLAY_NAME, setMainWindow, setupContextMenu, registerTlsTrustForWindow, setupNoInternetNetworkGuard, createSetupWindow, handleMainWindowClose, onClientOffline, onClientOnline }) {
  const isClient = config.mode === "client";
  const baselineSize = getMainWindowBaselineSize();

  const win = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: baselineSize.width,
    height: baselineSize.height,
    minWidth: baselineSize.minWidth,
    minHeight: baselineSize.minHeight,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(dirName, "preload.cjs"),
      sandbox: true,
      spellcheck: false,
      partition: isClient ? "otto-client" : "persist:otto-host",
      // Chromium's built-in PDF viewer is gated behind the plugins
      // webPreference. The job details modal renders saved order-sheet
      // PDFs in an iframe — without this the frame stays blank.
      plugins: true,
    },
  });

  setMainWindow(win);
  // Always-on host: give the owner a chance to hide-to-tray instead of closing.
  // When handleMainWindowClose returns false (production, client mode, real
  // quit, or no tray) the close proceeds normally — unchanged behavior.
  if (typeof handleMainWindowClose === "function") {
    win.on("close", (event) => {
      try {
        handleMainWindowClose(event, win);
      } catch {
        // never let a close-handler error trap the window
      }
    });
  }
  win.on("closed", () => {
    setMainWindow(null, win);
  });
  setupContextMenu(win);
  maybeOpenDevTools(win);
  // window.open / target=_blank: allow SAME-ORIGIN urls only (used by
  // "Open in new tab" on the order-sheet PDF — the child window shares
  // the session partition so the auth cookie rides along, and gets the
  // plugins pref so the PDF viewer works there too). The child gets no
  // preload, so it has no otto bridge — it's a plain viewer window.
  // Everything else stays denied, same as before.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === new URL(targetUrl).origin) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              plugins: true,
              partition: isClient ? "otto-client" : "persist:otto-host",
            },
          },
        };
      }
    } catch {
      // malformed URL — deny below
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(targetUrl);
      if (target.origin !== allowed.origin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

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
    async (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || win.isDestroyed()) return;
      loadFailCount++;

      // Host: after a few failures the embedded server is likely genuinely
      // broken — keep the existing Retry / Close dialog, and keep retrying
      // in-window until then (the host loads localhost, which doesn't wedge).
      if (config.mode === "host") {
        if (loadFailCount >= 3) {
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
        scheduleReconnect();
        return;
      }

      // Client: show the local offline page (only if not already on it — a
      // failed load leaves the last committed page in place), then recover via
      // TWO independent paths so one mechanism failing can't strand the client:
      //   1. in-window loadURL backoff (scheduleReconnect) — the same path the
      //      Host uses; it reconnects the instant the host answers, with no
      //      dependency on the main-process probe/relaunch timer. A fresh page
      //      load establishes a fresh connection, so it recovers a down host.
      //   2. the main-process host-probe + relaunch watch (onClientOffline), as
      //      a backstop. Whichever recovers first wins (a real load -> online
      //      cancels both).
      try {
        const cur = win.webContents.getURL() || "";
        if (!cur.startsWith("file:") && !win.isDestroyed()) win.loadFile(offlinePath);
      } catch { /* ignore */ }
      scheduleReconnect();
      try { if (typeof onClientOffline === "function") onClientOffline(win, errorCode, errorDescription); } catch { /* ignore */ }
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
      // A real load succeeded (e.g. reload-on-reopen caught the host back up) —
      // cancel any pending client reconnect watch so we don't relaunch.
      try { if (typeof onClientOnline === "function") onClientOnline(); } catch { /* ignore */ }
    }
  });

  // Background timers can be frozen while the app/VM sits idle (observed on a
  // Windows VM: the retry timer didn't fire for over a minute until the user
  // interacted), so a purely timer-driven retry can't be relied on. When the
  // window comes back to the foreground while we're still on the offline page,
  // retry immediately — that's exactly the moment the user is waiting for it.
  win.on("focus", () => {
    if (win.isDestroyed()) return;
    try {
      if ((win.webContents.getURL() || "").startsWith("file:")) loadApp();
    } catch { /* ignore */ }
  });

  registerTlsTrustForWindow(win, targetUrl, config);
  loadApp();
  setupNoInternetNetworkGuard(win.webContents.session, new URL(targetUrl).origin);
  injectCspOnSession(win.webContents.session);
  return win;
}

export function createBootWindow({ __dirname: dirName, APP_DISPLAY_NAME, setupNoInternetNetworkGuard }) {
  const win = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 520,
    height: 320,
    minWidth: 520,
    minHeight: 320,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      partition: "otto-boot",
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadFile(path.join(dirName, "boot.html"));
  setupNoInternetNetworkGuard(win.webContents.session);
  injectCspOnSession(win.webContents.session, { allowInlineScripts: true });
  return win;
}

export function createSetupWindow({ __dirname: dirName, APP_DISPLAY_NAME, getSetupWindow, setSetupWindow }) {
  const current = getSetupWindow();
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore();
    current.focus();
    return current;
  }

  const win = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Setup`,
    width: 780,
    height: 680,
    minWidth: 720,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(dirName, "preload.cjs"),
      sandbox: true,
      spellcheck: false,
      partition: "otto-setup",
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  injectCspOnSession(win.webContents.session, { allowInlineScripts: true });
  win.loadFile(path.join(dirName, "setup.html"));
  setSetupWindow(win);
  maybeOpenDevTools(win);
  win.on("closed", () => {
    setSetupWindow(null, win);
  });
  return win;
}

export function getTargetUrlForConfig(config, app) {
  const port = process.env.PORT || "5150";
  if (config.mode === "host") {
    return `${app.isPackaged ? "https" : "http"}://127.0.0.1:${port}`;
  }
  return config.hostUrl;
}

export function setupContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    const template = [];

    if (params.isEditable) {
      template.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else {
      template.push(
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    }

    if (template.length === 0) return;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });
}
