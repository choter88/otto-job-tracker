import path from "path";
import { BrowserWindow, Menu, screen } from "electron";

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

  let showingLoadError = false;
  win.webContents.on(
    "did-fail-load",
    async (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (showingLoadError) return;
      showingLoadError = true;

      const { dialog } = await import("electron");
      try {
        const isCertError =
          typeof errorDescription === "string" &&
          (errorDescription.includes("ERR_CERT") || errorDescription.toLowerCase().includes("certificate"));

        const buttons = isClient ? ["Retry", "Change Connection\u2026", "Close"] : ["Retry", "Close"];
        const messageBoxOpts = {
          type: "error",
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
          message: "Can't connect",
          detail:
            config.mode === "host"
              ? `The Host server is still starting.\n\nError: ${errorDescription}\nURL: ${validatedURL}`
              : `This Client can't reach the Host.\n\nCheck that:\n- The Host computer is on\n- Both computers are on the same office network\n- The Host address is correct${
                  isCertError ? "\n- The Pairing code matches the Host" : ""
                }\n\nError: ${errorDescription}\nURL: ${validatedURL}`,
        };

        let result = null;
        try {
          result = await dialog.showMessageBox(win, messageBoxOpts);
        } catch {
          result = await dialog.showMessageBox(messageBoxOpts);
        }

        if (win.isDestroyed()) return;

        if (result.response === 0) {
          try {
            win.loadURL(targetUrl);
          } catch {
            // ignore
          }
        } else if (isClient && result.response === 1) {
          createSetupWindow();
        } else {
          try {
            win.close();
          } catch {
            // ignore
          }
        }
      } finally {
        showingLoadError = false;
      }
    },
  );

  registerTlsTrustForWindow(win, targetUrl, config);
  win.loadURL(targetUrl);
  setupNoInternetNetworkGuard(win.webContents.session, new URL(targetUrl).origin);
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
