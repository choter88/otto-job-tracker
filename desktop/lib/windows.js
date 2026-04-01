import path from "path";
import { BrowserWindow, Menu, screen } from "electron";

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

  // Auto-reconnect: silently retry on the first 2 failures before showing
  // an error dialog. This makes brief Host restarts invisible to Clients.
  let loadFailCount = 0;
  let showingLoadError = false;
  const SILENT_RETRY_DELAYS = [3000, 5000]; // ms to wait before silent retries

  win.webContents.on(
    "did-fail-load",
    async (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (showingLoadError) return;

      loadFailCount++;

      // Silent retries for first 2 failures — no dialog, just wait and retry
      if (loadFailCount <= SILENT_RETRY_DELAYS.length && !win.isDestroyed()) {
        const delay = SILENT_RETRY_DELAYS[loadFailCount - 1];
        console.log(`[reconnect] Load failed (attempt ${loadFailCount}), silent retry in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        if (!win.isDestroyed()) {
          try { win.loadURL(targetUrl); } catch { /* ignore */ }
        }
        return;
      }

      // Third+ failure — show the dialog
      showingLoadError = true;
      const { dialog } = await import("electron");
      try {
        const buttons = isClient ? ["Retry", "Change Connection\u2026", "Close"] : ["Retry", "Close"];
        const messageBoxOpts = {
          type: "error",
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
          message:
            config.mode === "host"
              ? "Otto is still starting up"
              : "Can\u2019t connect to the main computer",
          detail:
            config.mode === "host"
              ? "This may take a moment. Click Retry to try again."
              : "Make sure the main computer is turned on and connected to the same office network as this one.\n\nIf the problem continues, ask your office manager or IT support for help.",
        };

        let result = null;
        try {
          result = await dialog.showMessageBox(win, messageBoxOpts);
        } catch {
          result = await dialog.showMessageBox(messageBoxOpts);
        }

        if (win.isDestroyed()) return;

        if (result.response === 0) {
          loadFailCount = 0; // Reset counter so manual Retry gets silent retries again
          try { win.loadURL(targetUrl); } catch { /* ignore */ }
        } else if (isClient && result.response === 1) {
          createSetupWindow();
        } else {
          try { win.close(); } catch { /* ignore */ }
        }
      } finally {
        showingLoadError = false;
      }
    },
  );

  // Reset fail counter on successful load
  win.webContents.on("did-finish-load", () => { loadFailCount = 0; });

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
