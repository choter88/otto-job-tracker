import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { randomBytes, X509Certificate } from "crypto";
import selfsigned from "selfsigned";
import Database from "better-sqlite3";

const APP_DISPLAY_NAME = "Otto Tracker";
const LEGACY_APP_DIR_NAME = "rest-express";

app.setName(APP_DISPLAY_NAME);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guardedSessions = new WeakSet();
const tlsTrustByWebContentsId = new Map();
const tlsTrustBySession = new WeakMap();
const certVerifyInstalled = new WeakSet();
let cachedHostTlsInfo = null;
let automaticBackupInterval = null;
let backupWarningShown = false;
let mainWindow = null;

process.on("uncaughtException", (error) => {
  logStartup("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  logStartup("Unhandled rejection", error);
});

function getStartupLogPath() {
  return path.join(app.getPath("userData"), "startup.log");
}

function logStartup(message, error) {
  try {
    const stamp = new Date().toISOString();
    const details =
      error && typeof error === "object"
        ? error.stack || error.message || JSON.stringify(error)
        : error
          ? String(error)
          : "";
    fs.mkdirSync(path.dirname(getStartupLogPath()), { recursive: true, mode: 0o700 });
    fs.appendFileSync(getStartupLogPath(), `[${stamp}] ${message}\n${details}\n\n`, { mode: 0o600 });
  } catch {
    // ignore
  }
}

function migrateLegacyUserDataDir() {
  try {
    const appData = app.getPath("appData");
    const legacyPath = path.join(appData, LEGACY_APP_DIR_NAME);
    const newPath = app.getPath("userData");
    if (legacyPath === newPath) return;
    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true, mode: 0o700 });
      fs.renameSync(legacyPath, newPath);
      logStartup(`Migrated user data to ${newPath}`);
    }
  } catch (error) {
    logStartup("Failed to migrate legacy user data folder", error);
  }
}

function getErrorLogPath() {
  if (process.env.OTTO_ERROR_LOG_PATH) return process.env.OTTO_ERROR_LOG_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  return path.join(dataDir, "error_log.json");
}

// Chromium-level hardening to reduce background network traffic.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-translate");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("safebrowsing-disable-auto-update");

function loadDevDotEnv() {
  // In development, align Electron with the same `.env` used by `npm run dev`.
  // (Packaged apps should rely on built-in defaults + internal app data paths.)
  if (app.isPackaged) return;

  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  try {
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key) continue;

      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

function getDefaultConfig() {
  return {
    mode: "host",
    hostUrl: "https://127.0.0.1:5150",
    pairingCode: "",
    trustedFingerprint256: "",
    backupDir: "",
    backupEnabled: true,
    backupRetention: 14,
    backupLastAt: 0,
    backupLastPath: "",
    backupLastError: "",
  };
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "otto-config.json");
}

function getDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function getOutboxPath() {
  return path.join(app.getPath("userData"), "otto-outbox.json");
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

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "").split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLocalHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h === "127.0.0.1") return true;
  if (!h.includes(".")) return true;
  if (h.endsWith(".local")) return true;
  return false;
}

async function testHostConnection(hostUrl, pairingCode) {
  if (!hostUrl || typeof hostUrl !== "string") {
    return { ok: false, message: "Please enter a Host address." };
  }

  let url;
  try {
    url = new URL(hostUrl);
  } catch {
    return { ok: false, message: "Please enter a valid Host address." };
  }

  const hostname = url.hostname;
  if (!isLocalHostname(hostname) && !isPrivateIpv4(hostname)) {
    return { ok: false, message: "Host address must be on the office network." };
  }

  const isHttps = url.protocol === "https:";
  const pairingHex = normalizePairingCodeHex(pairingCode || "");

  if (isHttps && pairingHex.length < 12) {
    return { ok: false, message: "Pairing code is required for HTTPS Hosts." };
  }

  const healthUrl = new URL("/api/health", url);
  const port = healthUrl.port || (isHttps ? "443" : "80");

  return await new Promise((resolve) => {
    const client = isHttps ? https : http;
    const req = client.request(
      {
        hostname: healthUrl.hostname,
        port,
        path: `${healthUrl.pathname}${healthUrl.search}`,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          if (isHttps) {
            const cert = res.socket?.getPeerCertificate?.();
            const certFp = normalizeHex(cert?.fingerprint256 || cert?.fingerprint);
            if (!certFp) {
              return resolve({ ok: false, message: "Could not read the Host certificate." });
            }
            if (!certFp.startsWith(pairingHex)) {
              return resolve({
                ok: false,
                message: "Pairing code does not match this Host. Check the code from the Host computer.",
              });
            }
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({
              ok: false,
              message: `Host responded with ${res.statusCode || "an error"}.`,
            });
          }

          return resolve({ ok: true, message: "Connection successful." });
        });
      },
    );

    req.on("error", (err) => {
      resolve({ ok: false, message: `Could not connect: ${err?.message || "Unknown error"}` });
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error("Connection timed out"));
    });

    req.end();
  });
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

function canEncryptOutbox() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readOutboxItems() {
  const outboxPath = getOutboxPath();
  if (!fs.existsSync(outboxPath)) return [];

  try {
    const raw = fs.readFileSync(outboxPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];

    if (parsed.encrypted === true) {
      if (!canEncryptOutbox()) return [];
      const payload = typeof parsed.payload === "string" ? parsed.payload : "";
      if (!payload) return [];
      const decrypted = safeStorage.decryptString(Buffer.from(payload, "base64"));
      const items = JSON.parse(decrypted);
      return Array.isArray(items) ? items : [];
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items;
  } catch {
    return [];
  }
}

function writeOutboxItems(items) {
  const outboxPath = getOutboxPath();
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true, mode: 0o700 });

  const capped = Array.isArray(items) ? items.slice(-500) : [];
  const encrypt = canEncryptOutbox();

  const payload = encrypt
    ? {
        version: 1,
        encrypted: true,
        payload: safeStorage.encryptString(JSON.stringify(capped)).toString("base64"),
      }
    : {
        version: 1,
        encrypted: false,
        items: capped,
      };

  fs.writeFileSync(outboxPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
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

function applyLicenseEgressAllowlist() {
  // Only the Host should ever talk to the internet, and only to the licensing portal.
  const raw = String(process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  const hostnames = new Set();
  try {
    const url = new URL(raw);
    if (url.hostname) hostnames.add(url.hostname);
  } catch {
    hostnames.add("ottojobtracker.com");
  }

  // Be resilient to redirects between `otto.com` and `www.otto.com`.
  for (const host of Array.from(hostnames)) {
    if (host.startsWith("www.")) hostnames.add(host.slice(4));
    else hostnames.add(`www.${host}`);
  }

  const existing = String(process.env.OTTO_EGRESS_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const hostname of hostnames) {
    existing.push(hostname);
  }

  process.env.OTTO_EGRESS_ALLOWLIST = Array.from(new Set(existing)).join(",");
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

  void import(pathToFileURL(serverEntry).href).catch((error) => {
    logStartup("Host server failed to start", error);
    try {
      dialog.showMessageBox({
        type: "error",
        message: "The Host server failed to start",
        detail:
          "Otto Tracker couldn’t start its local server.\n\n" +
          "Most common causes:\n" +
          "• The SQLite module failed to load\n" +
          "• Port 5150 is already in use\n" +
          "• The app doesn’t have permission to write its data folder\n\n" +
          `Log file:\n${getStartupLogPath()}`,
      });
    } catch {
      // ignore
    }
  });
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
    const originHost = url.hostname;

    const webContentsId = win.webContents.id;
    const session = win.webContents.session;

    if (config.mode === "host") {
      const tls = getHostTlsInfo();
      tlsTrustByWebContentsId.set(webContentsId, {
        mode: "host",
        origin,
        originHost,
        fingerprintHex: normalizeHex(tls.fingerprint256),
      });
    } else {
      tlsTrustByWebContentsId.set(webContentsId, {
        mode: "client",
        origin,
        originHost,
        fingerprintHex: normalizeHex(config.trustedFingerprint256),
        pairingCodeHex: normalizePairingCodeHex(config.pairingCode),
      });
    }

    // Install a per-session certificate verifier (more reliable than certificate-error).
    const trust = tlsTrustByWebContentsId.get(webContentsId);
    tlsTrustBySession.set(session, trust);

    if (!certVerifyInstalled.has(session)) {
      certVerifyInstalled.add(session);
      session.setCertificateVerifyProc((request, callback) => {
        try {
          const current = tlsTrustBySession.get(session);
          if (!current) return callback(-3);

          const hostname = request?.hostname || "";
          if (current.originHost && hostname && hostname !== current.originHost) {
            return callback(-3);
          }

          const certFpHex = normalizeHex(
            request?.certificate?.fingerprint256 || request?.certificate?.fingerprint,
          );

          if (current.fingerprintHex && certFpHex && certFpHex === current.fingerprintHex) {
            return callback(0);
          }

          if (current.mode === "client" && current.pairingCodeHex && certFpHex) {
            if (certFpHex.startsWith(current.pairingCodeHex)) {
              try {
                const cfg = readConfig();
                if (cfg.mode === "client") {
                  const formatted =
                    typeof request?.certificate?.fingerprint256 === "string"
                      ? request.certificate.fingerprint256
                      : formatFingerprint256(certFpHex);
                  if (normalizeHex(cfg.trustedFingerprint256) !== certFpHex) {
                    writeConfig({ ...cfg, trustedFingerprint256: formatted });
                  }
                }
              } catch {
                // ignore
              }
              return callback(0);
            }
          }

          if (current.mode === "host" && isLocalHostname(hostname)) {
            return callback(0);
          }

          return callback(-2);
        } catch {
          return callback(-2);
        }
      });
    }

    win.on("closed", () => {
      tlsTrustByWebContentsId.delete(webContentsId);
      tlsTrustBySession.delete(session);
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
    title: APP_DISPLAY_NAME,
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

  mainWindow = win;
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

function createBootWindow() {
  const win = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 520,
    height: 320,
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
  win.loadFile(path.join(__dirname, "boot.html"));
  setupNoInternetNetworkGuard(win.webContents.session);
  return win;
}

function createSetupWindow() {
  const win = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Setup`,
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

async function waitForHostReady({ protocol, host, port, timeoutMs = 30000 }) {
  const deadline = Date.now() + timeoutMs;
  const client = protocol === "https" ? https : http;
  let lastError = null;

  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = client.request(
        {
          hostname: host,
          port,
          path: "/api/health",
          method: "GET",
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
        },
      );
      req.on("error", (err) => {
        lastError = err;
        resolve(false);
      });
      req.setTimeout(1500, () => {
        req.destroy(new Error("timeout"));
      });
      req.end();
    });

    if (ok) return { ok: true };
    await new Promise((r) => setTimeout(r, 500));
  }

  return { ok: false, error: lastError };
}

async function isPortAvailable(port, host) {
  return await new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") return resolve(false);
      resolve(true);
    });
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function showHostStartFailureDialog() {
  const { response } = await dialog.showMessageBox({
    type: "error",
    buttons: ["Retry", "Open Logs", "Quit"],
    defaultId: 0,
    cancelId: 2,
    message: "The Host server didn’t start",
    detail:
      "Otto Tracker couldn’t reach its local server after 30 seconds.\n\n" +
      "Most common causes:\n" +
      "• The SQLite module failed to load\n" +
      "• Port 5150 is already in use\n" +
      "• The app doesn’t have permission to write its data folder\n\n" +
      `Log file:\n${getStartupLogPath()}`,
  });

  if (response === 1) {
    shell.showItemInFolder(getStartupLogPath());
  } else if (response === 2) {
    app.quit();
  }

  return response;
}

async function showDiagnostics() {
  const config = readConfig();
  const port = process.env.PORT || "5150";
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "http";
  const appVersion = app.getVersion();
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  const details = [
    `App version: ${appVersion}`,
    `Mode: ${config.mode}`,
    `Host URL: ${config.hostUrl}`,
    `Protocol: ${protocol}`,
    `Port: ${port}`,
    "",
    `User data: ${app.getPath("userData")}`,
    `Config: ${getConfigPath()}`,
    `SQLite: ${getSqlitePath()}`,
    `Data dir: ${dataDir}`,
    "",
    `Startup log: ${getStartupLogPath()}`,
    `Error log: ${getErrorLogPath()}`,
  ].join("\n");

  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Copy", "Open Logs Folder", "OK"],
    defaultId: 2,
    cancelId: 2,
    message: "Diagnostics",
    detail: details,
  });

  if (response === 0) {
    clipboard.writeText(details);
  } else if (response === 1) {
    shell.showItemInFolder(getStartupLogPath());
  }
}

ipcMain.handle("otto:config:get", async () => readConfig());
ipcMain.handle("otto:config:set", async (_event, configInput) => {
  const previous = readConfig();
  const config = { ...getDefaultConfig(), ...previous, ...configInput };

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

ipcMain.handle("otto:connection:test", async (_event, payload) => {
  const hostUrl = payload?.hostUrl;
  const pairingCode = payload?.pairingCode;
  return await testHostConnection(hostUrl, pairingCode);
});

ipcMain.handle("otto:outbox:get", async () => {
  return readOutboxItems();
});

ipcMain.handle("otto:outbox:replace", async (_event, items) => {
  writeOutboxItems(items);
  return { ok: true };
});

ipcMain.handle("otto:outbox:clear", async () => {
  writeOutboxItems([]);
  return { ok: true };
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

function isAllowedNetworkBackupDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string") return false;
  const normalized = path.resolve(dirPath);

  if (process.platform === "darwin") {
    if (!normalized.startsWith("/Volumes/")) return false;
    try {
      const fsType = execFileSync("stat", ["-f", "%T", normalized], { encoding: "utf8" }).trim().toLowerCase();
      // Common network filesystem types on macOS
      const allowed = new Set(["smbfs", "nfs", "afpfs", "webdav", "cifs"]);
      return allowed.has(fsType);
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    if (normalized.startsWith("\\\\")) return true; // UNC path
    const root = path.parse(normalized).root; // e.g. "C:\\"
    const drive = root?.slice(0, 2)?.toUpperCase(); // "C:"
    const systemDrive = String(process.env.SystemDrive || "C:").toUpperCase();
    if (!drive || drive.length !== 2) return false;
    if (drive === systemDrive) return false;
    try {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`,
        ],
        { encoding: "utf8", windowsHide: true },
      )
        .trim()
        .split(/\s+/)[0];
      // DriveType: 4 = Network
      return out === "4";
    } catch {
      return false;
    }
  }

  // Best-effort for other platforms (not a target).
  return normalized.startsWith("/mnt/") || normalized.startsWith("/media/");
}

function networkBackupHelpText() {
  if (process.platform === "darwin") {
    return (
      "Please choose a shared office network folder.\n\n" +
      "Tip (Mac): connect to the office file server in Finder, then select the mounted share under /Volumes.\n" +
      "Example: /Volumes/OfficeShare/OttoBackups"
    );
  }

  if (process.platform === "win32") {
    return (
      "Please choose a shared office network folder.\n\n" +
      "Tip (Windows): select a UNC path like \\\\SERVER\\Share\\OttoBackups, or a mapped network drive like Z:\\OttoBackups."
    );
  }

  return "Please choose a shared office network folder.";
}

async function chooseNetworkBackupFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose Backup Folder (Network)",
    properties: ["openDirectory", "createDirectory"],
    message: "Choose a shared office network folder for daily backups.",
  });

  if (canceled || filePaths.length === 0) return null;
  const dirPath = filePaths[0];

  if (!isAllowedNetworkBackupDir(dirPath)) {
    await dialog.showMessageBox({
      type: "error",
      message: "That doesn’t look like a network folder.",
      detail: networkBackupHelpText(),
    });
    return null;
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.otto-backup-write-test-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "ok", { mode: 0o600 });
    fs.unlinkSync(testFile);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Can’t write to that folder.",
      detail:
        "Otto Tracker needs permission to save backups there.\n\n" +
        `Folder:\n${dirPath}\n\n` +
        `Error:\n${error?.message || error}`,
    });
    return null;
  }

  const current = readConfig();
  writeConfig({
    ...current,
    backupDir: dirPath,
    backupEnabled: true,
    backupLastError: "",
  });
  return dirPath;
}

function formatBackupTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function listBackupFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.startsWith("otto-backup-") && (name.endsWith(".sqlite") || name.endsWith(".db")))
      .sort()
      .map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

function enforceBackupRetention(dirPath, retentionCount) {
  const keep = Math.max(1, Number(retentionCount) || 14);
  const files = listBackupFiles(dirPath);
  if (files.length <= keep) return;

  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const filePath of toDelete) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

async function runBackupToNetworkFolder({ interactive, reason }) {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "No data to back up yet.",
        detail: "The database file was not found. Create at least one office/user/job first, then try again.",
      });
    }
    return;
  }

  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;

  let backupDir = config.backupDir;
  if (!backupDir) {
    if (!interactive) return;
    const chosen = await chooseNetworkBackupFolder();
    if (!chosen) return;
    backupDir = chosen;
  }

  if (!isAllowedNetworkBackupDir(backupDir)) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "Backup folder must be a network folder.",
        detail: networkBackupHelpText(),
      });
    }
    writeConfig({ ...config, backupLastError: "Backup folder is not a network folder." });
    return;
  }

  const stamp = formatBackupTimestamp(new Date());
  const finalPath = path.join(backupDir, `otto-backup-${stamp}.sqlite`);
  const tempPath = `${finalPath}.tmp`;

  const db = new Database(sqlitePath, { fileMustExist: true });
  try {
    try {
      await db.backup(tempPath);
      fs.renameSync(tempPath, finalPath);

      const updated = readConfig();
      writeConfig({
        ...updated,
        backupLastAt: Date.now(),
        backupLastPath: finalPath,
        backupLastError: "",
      });

      enforceBackupRetention(backupDir, updated.backupRetention);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }

      const updated = readConfig();
      writeConfig({
        ...updated,
        backupLastError: error?.message || String(error),
      });

      if (interactive) {
        await dialog.showMessageBox({
          type: "error",
          message: "Backup failed.",
          detail:
            `Folder:\n${backupDir}\n\n` +
            `Error:\n${error?.message || error}\n\n` +
            "Make sure the office network folder is connected and writable, then try again.",
        });
      }
      return;
    }
  } finally {
    db.close();
  }

  if (interactive) {
    await dialog.showMessageBox({
      type: "info",
      message: "Backup saved.",
      detail: `Saved to:\n${finalPath}\n\nThis folder should be a shared office network folder so you can recover if the Host computer is replaced.`,
    });
  }
}

async function restoreDatabase() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select Backup File",
    properties: ["openFile"],
    filters: [{ name: "SQLite Backup", extensions: ["sqlite", "db"] }],
    defaultPath: (() => {
      const config = readConfig();
      return config.backupDir || app.getPath("documents");
    })(),
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

function scheduleAutomaticBackups() {
  if (automaticBackupInterval) {
    clearInterval(automaticBackupInterval);
    automaticBackupInterval = null;
  }

  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;
  if (!config.backupDir) return;

  const ONE_DAY_MS = 1000 * 60 * 60 * 24;
  const lastAt = Number(config.backupLastAt) || 0;
  const now = Date.now();
  const due = now - lastAt > ONE_DAY_MS;

  if (due) {
    setTimeout(() => {
      runBackupToNetworkFolder({ interactive: false, reason: "startup" }).catch(() => {});
    }, 30_000);
  }

  automaticBackupInterval = setInterval(() => {
    runBackupToNetworkFolder({ interactive: false, reason: "scheduled" }).catch(() => {});
  }, ONE_DAY_MS);
}

async function maybePromptForBackupFolder() {
  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;
  if (config.backupDir) return;

  const result = await dialog.showMessageBox({
    type: "info",
    buttons: ["Choose Backup Folder…", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    message: "Set up daily backups (recommended)",
    detail:
      "Otto Tracker can automatically save a daily backup to a shared office network folder.\n\n" +
      "This helps you recover if the Host computer is replaced.\n\n" +
      "Choose a network folder now?",
  });

  if (result.response !== 0) return;
  const chosen = await chooseNetworkBackupFolder();
  if (chosen) scheduleAutomaticBackups();
}

async function maybeWarnAboutBackups() {
  if (backupWarningShown) return;
  const config = readConfig();
  if (config.mode !== "host") return;
  if (config.backupEnabled === false) return;
  if (!config.backupDir) return;

  const now = Date.now();
  const lastAt = Number(config.backupLastAt) || 0;
  const tooOld = !lastAt || now - lastAt > 1000 * 60 * 60 * 24 * 2; // 2 days
  const hasError = Boolean(config.backupLastError);

  if (!tooOld && !hasError) return;
  backupWarningShown = true;

  const detailParts = [];
  if (lastAt) {
    detailParts.push(`Last backup: ${new Date(lastAt).toLocaleString()}`);
  } else {
    detailParts.push("Last backup: never");
  }
  if (config.backupLastPath) {
    detailParts.push(`Last backup file:\n${config.backupLastPath}`);
  }
  if (hasError) {
    detailParts.push(`Last error:\n${config.backupLastError}`);
  }

  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Back Up Now", "Choose Backup Folder…", "OK"],
    defaultId: 0,
    cancelId: 2,
    message: "Backups need attention",
    detail:
      detailParts.join("\n\n") +
      "\n\nDaily backups help you recover if the Host computer is replaced.",
  });

  if (result.response === 0) {
    await runBackupToNetworkFolder({ interactive: true, reason: "manual" });
  } else if (result.response === 1) {
    const chosen = await chooseNetworkBackupFolder();
    if (chosen) scheduleAutomaticBackups();
  }
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
              { label: "Choose Backup Folder…", click: () => chooseNetworkBackupFolder().then(() => scheduleAutomaticBackups()) },
              { label: "Back Up Now", click: () => runBackupToNetworkFolder({ interactive: true, reason: "manual" }) },
              { label: "Restore Data…", click: () => restoreDatabase() },
              { type: "separator" },
            ]
          : []),
        { label: "Change Connection…", click: () => createSetupWindow() },
        { label: "Diagnostics…", click: () => showDiagnostics() },
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
  loadDevDotEnv();
  migrateLegacyUserDataDir();
  applyOfflineDefaults();
  maybeRestoreDatabaseFromArgs();
  logStartup("App starting");

  const config = readConfig();
  setAppMenu(config);
  if (!fs.existsSync(getConfigPath())) {
    createSetupWindow();
    return;
  }

  let bootWindow = null;
  if (config.mode === "host") {
    bootWindow = createBootWindow();
  }

  if (config.mode === "host") {
    applyLicenseEgressAllowlist();
  }

  if (config.mode === "host" && app.isPackaged) {
    applyHostTlsEnv();
  }

  if (config.mode === "host") {
    const port = Number(process.env.PORT || "5150");
    const available = await isPortAvailable(port, "0.0.0.0");
    if (!available) {
      await dialog.showMessageBox({
        type: "error",
        message: `Port ${port} is already in use`,
        detail:
          "Another app is using the port Otto Tracker needs.\n\n" +
          "Please close the other app (or restart your computer) and try again.",
      });
      return;
    }
  }

  await maybeStartHostServer();

  if (config.mode === "host") {
    const protocol = app.isPackaged ? "https" : "http";
    const port = process.env.PORT || "5150";
    let readiness = await waitForHostReady({
      protocol,
      host: "127.0.0.1",
      port,
      timeoutMs: 30000,
    });

    while (!readiness.ok) {
      const action = await showHostStartFailureDialog();
      if (action !== 0) {
        return;
      }
      readiness = await waitForHostReady({
        protocol,
        host: "127.0.0.1",
        port,
        timeoutMs: 30000,
      });
    }
  }

  const port = process.env.PORT || "5150";
  const targetUrl =
    config.mode === "host"
      ? `${app.isPackaged ? "https" : "http"}://127.0.0.1:${port}`
      : config.hostUrl;
  createWindow(targetUrl, config);

  if (bootWindow) {
    bootWindow.close();
  }

  if (config.mode === "host") {
    await maybePromptForBackupFolder();
    await maybeWarnAboutBackups();
    scheduleAutomaticBackups();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
