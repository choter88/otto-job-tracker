import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { randomBytes, X509Certificate } from "crypto";
import selfsigned from "selfsigned";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guardedSessions = new WeakSet();
const tlsTrustByWebContentsId = new Map();
let cachedHostTlsInfo = null;

// Chromium-level hardening to reduce background network traffic.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-translate");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("safebrowsing-disable-auto-update");

function getDefaultConfig() {
  return {
    mode: "host",
    hostUrl: "https://127.0.0.1:5150",
    pairingCode: "",
    trustedFingerprint256: "",
  };
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "otto-config.json");
}

function getDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function getSqlitePath() {
  return process.env.OTTO_SQLITE_PATH || path.join(getDataDir(), "otto.sqlite");
}

function normalizeHex(value) {
  if (!value) return "";
  return String(value).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function formatFingerprint256(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return "";
  const pairs = normalized.match(/.{1,2}/g) || [];
  return pairs.join(":");
}

function pairingCodeFromFingerprintHex(hex) {
  const normalized = normalizeHex(hex);
  if (normalized.length < 12) return "";
  const code = normalized.slice(0, 12);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

function normalizePairingCodeHex(value) {
  const normalized = normalizeHex(value);
  return normalized.length >= 12 ? normalized.slice(0, 12) : normalized;
}

function getTlsDir() {
  return path.join(app.getPath("userData"), "tls");
}

function getTlsKeyPath() {
  return path.join(getTlsDir(), "otto-host.key.pem");
}

function getTlsCertPath() {
  return path.join(getTlsDir(), "otto-host.cert.pem");
}

function getHostTlsInfo() {
  if (cachedHostTlsInfo) return cachedHostTlsInfo;

  const tlsDir = getTlsDir();
  const keyPath = getTlsKeyPath();
  const certPath = getTlsCertPath();

  fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });

  let keyPem = "";
  let certPem = "";
  const hasKey = fs.existsSync(keyPath);
  const hasCert = fs.existsSync(certPath);

  if (hasKey && hasCert) {
    keyPem = fs.readFileSync(keyPath, "utf-8");
    certPem = fs.readFileSync(certPath, "utf-8");
  } else {
    const attrs = [{ name: "commonName", value: "Otto Tracker Host" }];
    const pems = selfsigned.generate(attrs, {
      algorithm: "sha256",
      days: 3650,
      keySize: 2048,
    });

    keyPem = pems.private;
    certPem = pems.cert;

    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
    fs.writeFileSync(certPath, certPem, { mode: 0o600 });
  }

  let fingerprint256 = "";
  try {
    fingerprint256 = new X509Certificate(certPem).fingerprint256;
  } catch {
    // ignore
  }

  cachedHostTlsInfo = {
    keyPath,
    certPath,
    fingerprint256,
  };
  return cachedHostTlsInfo;
}

function applyHostTlsEnv() {
  const tls = getHostTlsInfo();
  process.env.OTTO_TLS = "true";
  process.env.OTTO_TLS_KEY_PATH = tls.keyPath;
  process.env.OTTO_TLS_CERT_PATH = tls.certPath;
  process.env.OTTO_COOKIE_SECURE = "true";
  return tls;
}

function ensureSessionSecret() {
  if (process.env.SESSION_SECRET) return;

  const secretPath = path.join(app.getPath("userData"), "session-secret.txt");
  try {
    const secret = fs.readFileSync(secretPath, "utf-8").trim();
    if (secret) {
      process.env.SESSION_SECRET = secret;
      return;
    }
  } catch {
    // ignore
  }

  const secret = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  process.env.SESSION_SECRET = secret;
}

function readConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return { ...getDefaultConfig(), ...JSON.parse(raw) };
  } catch {
    return getDefaultConfig();
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function applyOfflineDefaults() {
  if (!process.env.PORT) process.env.PORT = "5150";
  if (!process.env.OTTO_LISTEN_HOST) process.env.OTTO_LISTEN_HOST = "0.0.0.0";
  if (!process.env.OTTO_AIRGAP) process.env.OTTO_AIRGAP = "true";
  if (!process.env.OTTO_LAN_ONLY) process.env.OTTO_LAN_ONLY = "true";
  if (!process.env.OTTO_DATA_DIR) process.env.OTTO_DATA_DIR = getDataDir();
  if (!process.env.OTTO_SQLITE_PATH) process.env.OTTO_SQLITE_PATH = getSqlitePath();
  ensureSessionSecret();
}

function maybeRestoreDatabaseFromArgs() {
  const idx = process.argv.indexOf("--restore");
  if (idx === -1) return;

  const restoreFrom = process.argv[idx + 1];
  if (!restoreFrom) return;

  const sqlitePath = getSqlitePath();
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });

  try {
    if (!fs.existsSync(restoreFrom)) {
      throw new Error("Backup file not found");
    }

    const walPath = `${sqlitePath}-wal`;
    const shmPath = `${sqlitePath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    fs.copyFileSync(restoreFrom, sqlitePath);
  } catch (error) {
    // If restore fails, continue startup and let the user try again from the menu.
    console.error("Restore failed:", error);
  }
}

async function maybeStartHostServer() {
  const config = readConfig();
  if (config.mode !== "host") return;

  // In development, assume you're running `npm run dev` separately.
  // (A packaged app starts its own local server automatically.)
  if (!app.isPackaged) return;

  if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

  const repoRoot = path.resolve(__dirname, "..");
  const serverEntry = path.join(repoRoot, "dist", "index.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server build not found at ${serverEntry}. Run \`npm run build\` first.`);
  }

  await import(pathToFileURL(serverEntry).href);
}

function setupNoInternetNetworkGuard(electronSession, allowedOrigin) {
  if (guardedSessions.has(electronSession)) return;
  guardedSessions.add(electronSession);

  const allowedHostPort = (() => {
    if (!allowedOrigin) return null;
    try {
      const url = new URL(allowedOrigin);
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      return `${url.hostname}:${port}`;
    } catch {
      return null;
    }
  })();

  electronSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const allowedSchemes = new Set([
        "file:",
        "about:",
        "blob:",
        "data:",
        "devtools:",
        "chrome-error:",
        "chrome:",
      ]);
      if (allowedSchemes.has(url.protocol)) {
        return callback({ cancel: false });
      }

      const port =
        url.port ||
        (url.protocol === "https:" || url.protocol === "wss:"
          ? "443"
          : url.protocol === "http:" || url.protocol === "ws:"
            ? "80"
            : "");
      const hostPort = port ? `${url.hostname}:${port}` : url.hostname;
      if (allowedHostPort && hostPort === allowedHostPort) {
        return callback({ cancel: false });
      }

      return callback({ cancel: true });
    } catch {
      return callback({ cancel: true });
    }
  });
}

function registerTlsTrustForWindow(win, targetUrl, config) {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "https:") return;

    const origin = url.origin;

    if (config.mode === "host") {
      const tls = getHostTlsInfo();
      tlsTrustByWebContentsId.set(win.webContents.id, {
        mode: "host",
        origin,
        fingerprintHex: normalizeHex(tls.fingerprint256),
      });
    } else {
      tlsTrustByWebContentsId.set(win.webContents.id, {
        mode: "client",
        origin,
        fingerprintHex: normalizeHex(config.trustedFingerprint256),
        pairingCodeHex: normalizePairingCodeHex(config.pairingCode),
      });
    }

    win.on("closed", () => {
      tlsTrustByWebContentsId.delete(win.webContents.id);
    });
  } catch {
    // ignore
  }
}

app.on("certificate-error", (event, webContents, url, _error, certificate, callback) => {
  try {
    const trust = tlsTrustByWebContentsId.get(webContents.id);
    if (!trust) return callback(false);

    const requestOrigin = new URL(url).origin;
    if (requestOrigin !== trust.origin) return callback(false);

    const certFpHex = normalizeHex(certificate?.fingerprint256 || certificate?.fingerprint);
    if (!certFpHex) return callback(false);

    if (trust.fingerprintHex && certFpHex === trust.fingerprintHex) {
      event.preventDefault();
      return callback(true);
    }

    // First-time client pairing via short code (derived from the cert fingerprint).
    if (trust.mode === "client" && trust.pairingCodeHex && certFpHex.startsWith(trust.pairingCodeHex)) {
      try {
        const current = readConfig();
        if (current.mode === "client") {
          const formatted =
            typeof certificate?.fingerprint256 === "string"
              ? certificate.fingerprint256
              : formatFingerprint256(certFpHex);

          if (normalizeHex(current.trustedFingerprint256) !== certFpHex) {
            writeConfig({ ...current, trustedFingerprint256: formatted });
          }
        }
      } catch {
        // ignore
      }

      event.preventDefault();
      return callback(true);
    }

    return callback(false);
  } catch {
    return callback(false);
  }
});

function createWindow(targetUrl, config) {
  const isClient = config.mode === "client";

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      spellcheck: false,
      partition: isClient ? "otto-client" : "persist:otto-host",
    },
  });

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

      try {
        const isCertError =
          typeof errorDescription === "string" &&
          (errorDescription.includes("ERR_CERT") || errorDescription.toLowerCase().includes("certificate"));

        const buttons = isClient ? ["Retry", "Change Connection…", "Close"] : ["Retry", "Close"];
        const result = await dialog.showMessageBox(win, {
          type: "error",
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
          message: "Can’t connect",
          detail:
            config.mode === "host"
              ? `The Host server is still starting.\n\nError: ${errorDescription}\nURL: ${validatedURL}`
              : `This Client can’t reach the Host.\n\nCheck that:\n- The Host computer is on\n- Both computers are on the same office network\n- The Host address is correct${
                  isCertError ? "\n- The Pairing code matches the Host" : ""
                }\n\nError: ${errorDescription}\nURL: ${validatedURL}`,
        });

        if (result.response === 0) {
          win.loadURL(targetUrl);
        } else if (isClient && result.response === 1) {
          createSetupWindow();
        } else {
          win.close();
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

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      spellcheck: false,
      partition: "otto-setup",
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadFile(path.join(__dirname, "setup.html"));
  setupNoInternetNetworkGuard(win.webContents.session);
  return win;
}

ipcMain.handle("otto:config:get", async () => readConfig());
ipcMain.handle("otto:config:set", async (_event, configInput) => {
  const previous = readConfig();
  const config = { ...getDefaultConfig(), ...configInput };

  if (config.mode !== "client") {
    config.pairingCode = "";
    config.trustedFingerprint256 = "";
  } else {
    const previousOrigin = (() => {
      try {
        return new URL(previous.hostUrl).origin;
      } catch {
        return null;
      }
    })();

    const nextOrigin = (() => {
      try {
        return new URL(config.hostUrl).origin;
      } catch {
        return null;
      }
    })();

    if (previousOrigin && nextOrigin && previousOrigin !== nextOrigin) {
      config.trustedFingerprint256 = "";
    }
  }

  writeConfig(config);
  app.relaunch();
  app.exit(0);
});

async function showHostAddresses() {
  const port = process.env.PORT || "5150";
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "http";
  const nets = os.networkInterfaces();

  const addresses = Object.values(nets)
    .flat()
    .filter(Boolean)
    .filter((n) => n.family === "IPv4" && !n.internal)
    .map((n) => `${protocol}://${n.address}:${port}`);

  const unique = Array.from(new Set(addresses)).sort();
  const pairingCode =
    protocol === "https"
      ? pairingCodeFromFingerprintHex(getHostTlsInfo().fingerprint256)
      : "";

  const message = (() => {
    if (unique.length === 0) {
      return "No LAN address found. Make sure this computer is connected to the office network (Wi‑Fi/Ethernet).";
    }

    const base = `Use one of these addresses on Client computers:\n\n${unique.join("\n")}\n\n(They must be on the same office network.)`;
    if (!pairingCode) return base;
    return `${base}\n\nPairing code (enter on Clients):\n${pairingCode}`;
  })();

  const buttons =
    unique.length > 0 && pairingCode
      ? ["Copy Host Address", "Copy Pairing Code", "OK"]
      : unique.length > 0
        ? ["Copy Host Address", "OK"]
        : ["OK"];

  const result = await dialog.showMessageBox({
    type: "info",
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    message: "Host Address",
    detail: message,
  });

  if (unique.length > 0) {
    if (result.response === 0) clipboard.writeText(unique[0]);
    if (pairingCode && result.response === 1) clipboard.writeText(pairingCode);
  }
}

async function backupDatabase() {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    await dialog.showMessageBox({
      type: "error",
      message: "No data to back up yet.",
      detail: "The database file was not found. Create at least one office/user/job first, then try again.",
    });
    return;
  }

  const defaultName = `otto-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Save Backup",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "SQLite Backup", extensions: ["sqlite", "db"] }],
  });

  if (canceled || !filePath) return;

  const db = new Database(sqlitePath, { fileMustExist: true });
  try {
    await db.backup(filePath);
  } finally {
    db.close();
  }

  await dialog.showMessageBox({
    type: "info",
    message: "Backup saved.",
    detail: `Saved to:\n${filePath}\n\nStore this file somewhere safe (for example a USB drive).`,
  });
}

async function restoreDatabase() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select Backup File",
    properties: ["openFile"],
    filters: [{ name: "SQLite Backup", extensions: ["sqlite", "db"] }],
  });

  if (canceled || filePaths.length === 0) return;
  const backupPath = filePaths[0];

  const confirm = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Restore", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Restore backup?",
    detail: "This will replace the current data on this Host computer. Continue only if you are sure.",
  });

  if (confirm.response !== 0) return;

  app.relaunch({ args: [...process.argv.slice(1), "--restore", backupPath] });
  app.exit(0);
}

function setAppMenu(config) {
  const isHost = config.mode === "host";
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";

  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(isHost
          ? [
              { label: "Show Host Address…", click: () => showHostAddresses() },
              { type: "separator" },
              { label: "Backup Data…", click: () => backupDatabase() },
              { label: "Restore Data…", click: () => restoreDatabase() },
              { type: "separator" },
            ]
          : []),
        { label: "Change Connection…", click: () => createSetupWindow() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? [
              { role: "reload" },
              { role: "forceReload" },
              { type: "separator" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  applyOfflineDefaults();
  maybeRestoreDatabaseFromArgs();

  const config = readConfig();
  setAppMenu(config);
  if (!fs.existsSync(getConfigPath())) {
    createSetupWindow();
    return;
  }

  if (config.mode === "host" && app.isPackaged) {
    applyHostTlsEnv();
  }

  await maybeStartHostServer();

  const port = process.env.PORT || "5150";
  const targetUrl =
    config.mode === "host"
      ? `${app.isPackaged ? "https" : "http"}://127.0.0.1:${port}`
      : config.hostUrl;
  createWindow(targetUrl, config);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
