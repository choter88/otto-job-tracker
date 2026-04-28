import path from "path";
import { BrowserWindow, Menu, screen } from "electron";

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
  const policy = allowInlineScripts ? CSP_LOCAL_HTML : CSP_APP;
  ses.webRequest.onHeadersReceived((details, callback) => {
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

export function createWindow(targetUrl, config, { __dirname: dirName, APP_DISPLAY_NAME, setMainWindow, setupContextMenu, registerTlsTrustForWindow, setupNoInternetNetworkGuard, createSetupWindow }) {
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
    },
  });

  setMainWindow(win);
  win.on("closed", () => {
    setMainWindow(null, win);
  });
  setupContextMenu(win);
  maybeOpenDevTools(win);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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

  // Auto-reconnect with exponential backoff.
  // Clients retry indefinitely in the background — the Host may be
  // restarting, and the user's offline changes are safe in the outbox.
  // After several silent retries, show a non-blocking notification so
  // the user knows we're still trying.
  let loadFailCount = 0;
  let reconnectTimer = null;
  const MAX_BACKOFF_MS = 15000; // cap at 15 seconds between retries

  function getBackoffDelay(attempt) {
    return Math.min(MAX_BACKOFF_MS, 2000 * Math.pow(1.5, Math.min(attempt, 10)));
  }

  win.webContents.on(
    "did-fail-load",
    async (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || win.isDestroyed()) return;

      loadFailCount++;
      const delay = getBackoffDelay(loadFailCount);

      // For Host mode, show dialog after 3 failures (server might be genuinely broken)
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
        if (response === 0) {
          loadFailCount = 0;
          try { win.loadURL(targetUrl); } catch { /* ignore */ }
        } else {
          try { win.close(); } catch { /* ignore */ }
        }
        return;
      }

      // For Client mode, keep retrying silently with backoff
      console.log(`[reconnect] Load failed (attempt ${loadFailCount}), retrying in ${Math.round(delay / 1000)}s...`);

      // After 5 silent failures, show a small in-window message (not a blocking dialog)
      if (isClient && loadFailCount === 5) {
        try {
          win.webContents.executeJavaScript(`
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;background:#f8fafc;color:#374151;text-align:center;padding:2rem;">' +
              '<div><h2 style="font-size:1.25rem;font-weight:600;margin-bottom:0.5rem;">Host is offline</h2>' +
              '<p style="font-size:0.875rem;color:#6b7280;">Otto is read-only until Otto is opened back up on the main computer.</p>' +
              '<p style="font-size:0.75rem;color:#9ca3af;margin-top:0.75rem;">Reconnecting automatically every few seconds</p>' +
              '<button onclick="window.location.reload()" style="margin-top:1.25rem;padding:0.5rem 1.5rem;background:#2563eb;color:white;border:none;border-radius:0.5rem;font-size:0.875rem;font-weight:500;cursor:pointer;">Try Now</button>' +
              '</div></div>';
          `).catch(() => {});
        } catch { /* ignore */ }
      }

      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!win.isDestroyed()) {
          try { win.loadURL(targetUrl); } catch { /* ignore */ }
        }
      }, delay);
    },
  );

  // Reset fail counter on successful load
  win.webContents.on("did-finish-load", () => {
    loadFailCount = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  });

  registerTlsTrustForWindow(win, targetUrl, config);
  win.loadURL(targetUrl);
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
