import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, screen, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";

// --- Module imports ---
import {
  getStartupLogPath,
  logStartup,
  migrateLegacyUserDataDir,
  getErrorLogPath,
  loadDevDotEnv,
  getDefaultConfig,
  getConfigPath,
  getDataDir,
  getOutboxPath,
  getSqlitePath,
  getLocalBackupDir,
  readConfig as readConfigRaw,
  writeConfig as writeConfigRaw,
  applyOfflineDefaults as applyOfflineDefaultsRaw,
  applyLicenseEgressAllowlist,
  getPortalBaseUrl,
} from "./lib/config.js";

import {
  isPrivateIpv4,
  isLocalHostname,
  normalizeDiscoveryHostUrl,
  getLocalSubnetHostCandidates,
  mapWithConcurrency,
  requestJsonWithFingerprint,
  normalizeHex,
  formatFingerprint256,
  pairingCodeFromFingerprintHex,
  normalizePairingCodeHex,
  normalizeFingerprint256Hex,
  fingerprintHexFromCertificate,
  getPeerFingerprintHex,
  HOST_DISCOVERY_TIMEOUT_MS,
  HOST_DISCOVERY_CONCURRENCY,
  HOST_DISCOVERY_MAX_CANDIDATES,
} from "./lib/discovery.js";

import {
  getTlsDir,
  getTlsKeyPath,
  getTlsCertPath,
  getHostTlsInfo as getHostTlsInfoRaw,
  applyHostTlsEnv as applyHostTlsEnvRaw,
  ensureSessionSecret,
} from "./lib/tls.js";

import {
  canEncryptOutbox as canEncryptOutboxRaw,
  readOutboxItems as readOutboxItemsRaw,
  writeOutboxItems as writeOutboxItemsRaw,
} from "./lib/outbox.js";

import {
  isAllowedNetworkBackupDir,
  networkBackupHelpText,
  chooseNetworkBackupFolder as chooseNetworkBackupFolderRaw,
  formatBackupTimestamp,
  listBackupFiles,
  enforceBackupRetention,
  runBackupToLocalFolder as runBackupToLocalFolderRaw,
  runBackupToNetworkFolder as runBackupToNetworkFolderRaw,
  restoreDatabase as restoreDatabaseRaw,
  scheduleAutomaticBackups as scheduleAutomaticBackupsRaw,
  maybePromptForBackupFolder as maybePromptForBackupFolderRaw,
  maybeWarnAboutBackups as maybeWarnAboutBackupsRaw,
} from "./lib/backup.js";

import {
  getDisplayWorkAreaForBounds,
  getMainWindowBaselineSize,
  setMainWindowMinWidth,
  createWindow as createWindowRaw,
  createBootWindow as createBootWindowRaw,
  createSetupWindow as createSetupWindowRaw,
  getTargetUrlForConfig as getTargetUrlForConfigRaw,
  setupContextMenu,
} from "./lib/windows.js";

import {
  sanitizeConfigForSupport,
  readErrorLogSummary,
  summarizeOutboxItems,
  showDiagnostics as showDiagnosticsRaw,
  exportSupportBundle as exportSupportBundleRaw,
  computeHostInfo as computeHostInfoRaw,
  showHostAddresses as showHostAddressesRaw,
} from "./lib/diagnostics.js";

import {
  setAppMenu as setAppMenuRaw,
} from "./lib/menu.js";

// --- Constants ---
const APP_DISPLAY_NAME = "Otto Tracker";

app.setName(APP_DISPLAY_NAME);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Global state ---
const guardedSessions = new WeakSet();
const tlsTrustByWebContentsId = new Map();
const tlsTrustBySession = new WeakMap();
const certVerifyInstalled = new WeakSet();
let automaticBackupInterval = null;
let backupWarningShown = false;
let mainWindow = null;
let setupWindow = null;
let appReadyForOpenEvents = false;
const pendingOpenUrls = [];
const pendingOpenFiles = [];

// --- Bound helper functions (currying app/safeStorage into module functions) ---

function _logStartup(message, error) {
  logStartup(app, message, error);
}

function _getStartupLogPath() {
  return getStartupLogPath(app);
}

function _getConfigPath() {
  return getConfigPath(app);
}

function _getDataDir() {
  return getDataDir(app);
}

function _getOutboxPath() {
  return getOutboxPath(app);
}

function _getSqlitePath() {
  return getSqlitePath(app);
}

function _getLocalBackupDir() {
  return getLocalBackupDir(app);
}

function _readConfig() {
  return readConfigRaw(app);
}

function _writeConfig(config) {
  writeConfigRaw(app, config);
}

function _getHostTlsInfo() {
  return getHostTlsInfoRaw(app);
}

function _applyHostTlsEnv() {
  return applyHostTlsEnvRaw(app);
}

function _canEncryptOutbox() {
  return canEncryptOutboxRaw(safeStorage);
}

function _readOutboxItems() {
  return readOutboxItemsRaw({ app, safeStorage, getOutboxPath });
}

function _writeOutboxItems(items) {
  writeOutboxItemsRaw(items, { app, safeStorage, getOutboxPath });
}

function _chooseNetworkBackupFolder() {
  return chooseNetworkBackupFolderRaw({ dialog, readConfig: _readConfig, writeConfig: _writeConfig });
}

function _runBackupToLocalFolder(opts) {
  return runBackupToLocalFolderRaw(opts, {
    dialog,
    readConfig: _readConfig,
    writeConfig: _writeConfig,
    getSqlitePath: _getSqlitePath,
    getLocalBackupDir: _getLocalBackupDir,
  });
}

function _runBackupToNetworkFolder(opts) {
  return runBackupToNetworkFolderRaw(opts, {
    dialog,
    readConfig: _readConfig,
    writeConfig: _writeConfig,
    getSqlitePath: _getSqlitePath,
    chooseNetworkBackupFolder: _chooseNetworkBackupFolder,
  });
}

function _restoreDatabase() {
  return restoreDatabaseRaw({ app, dialog, readConfig: _readConfig, getLocalBackupDir: _getLocalBackupDir });
}

function _scheduleAutomaticBackups() {
  scheduleAutomaticBackupsRaw({
    readConfig: _readConfig,
    runLocalBackup: _runBackupToLocalFolder,
    runNetworkBackup: _runBackupToNetworkFolder,
    getIntervalRef: () => automaticBackupInterval,
    setIntervalRef: (v) => { automaticBackupInterval = v; },
  });
}

function _maybePromptForBackupFolder() {
  return maybePromptForBackupFolderRaw({
    dialog,
    readConfig: _readConfig,
    chooseNetworkBackupFolder: _chooseNetworkBackupFolder,
    scheduleAutomaticBackups: _scheduleAutomaticBackups,
  });
}

function _maybeWarnAboutBackups() {
  return maybeWarnAboutBackupsRaw({
    dialog,
    readConfig: _readConfig,
    getLocalBackupDir: _getLocalBackupDir,
    runNetworkBackup: _runBackupToNetworkFolder,
    runLocalBackup: _runBackupToLocalFolder,
    chooseNetworkBackupFolder: _chooseNetworkBackupFolder,
    scheduleAutomaticBackups: _scheduleAutomaticBackups,
    getBackupWarningShown: () => backupWarningShown,
    setBackupWarningShown: (v) => { backupWarningShown = v; },
  });
}

function _createSetupWindow() {
  return createSetupWindowRaw({
    __dirname,
    APP_DISPLAY_NAME,
    getSetupWindow: () => setupWindow,
    setSetupWindow: (win, prev) => {
      if (win === null && prev) {
        if (setupWindow === prev) setupWindow = null;
      } else {
        setupWindow = win;
      }
    },
  });
}

function _createWindow(targetUrl, config) {
  return createWindowRaw(targetUrl, config, {
    __dirname,
    APP_DISPLAY_NAME,
    setMainWindow: (win, prev) => {
      if (win === null && prev) {
        if (mainWindow === prev) mainWindow = null;
      } else {
        mainWindow = win;
      }
    },
    setupContextMenu,
    registerTlsTrustForWindow,
    setupNoInternetNetworkGuard,
    createSetupWindow: _createSetupWindow,
  });
}

function _createBootWindow() {
  return createBootWindowRaw({ __dirname, APP_DISPLAY_NAME, setupNoInternetNetworkGuard });
}

function _getTargetUrlForConfig(config) {
  return getTargetUrlForConfigRaw(config, app);
}

function _computeHostInfo() {
  return computeHostInfoRaw({ getHostTlsInfo: _getHostTlsInfo, pairingCodeFromFingerprintHex });
}

function _showHostAddresses() {
  return showHostAddressesRaw({ dialog, clipboard, computeHostInfo: _computeHostInfo });
}

function _showDiagnostics() {
  return showDiagnosticsRaw({
    app,
    dialog,
    clipboard,
    shell,
    readConfig: _readConfig,
    readOutboxItems: _readOutboxItems,
    canEncryptOutbox: _canEncryptOutbox,
    getConfigPath: _getConfigPath,
    getSqlitePath: _getSqlitePath,
    getLocalBackupDir: _getLocalBackupDir,
    getStartupLogPath: _getStartupLogPath,
    getErrorLogPath,
    getOutboxPath: _getOutboxPath,
  });
}

function _exportSupportBundle() {
  return exportSupportBundleRaw({
    app,
    dialog,
    shell,
    readConfig: _readConfig,
    readOutboxItems: _readOutboxItems,
    getConfigPath: _getConfigPath,
    getSqlitePath: _getSqlitePath,
    getStartupLogPath: _getStartupLogPath,
    getErrorLogPath,
    getOutboxPath: _getOutboxPath,
    APP_DISPLAY_NAME,
  });
}

function _setAppMenu(config) {
  setAppMenuRaw(config, {
    app,
    shell,
    showHostAddresses: _showHostAddresses,
    chooseNetworkBackupFolder: _chooseNetworkBackupFolder,
    scheduleAutomaticBackups: _scheduleAutomaticBackups,
    runBackupToNetworkFolder: _runBackupToNetworkFolder,
    restoreDatabase: _restoreDatabase,
    createSetupWindow: _createSetupWindow,
    showDiagnostics: _showDiagnostics,
    exportSupportBundle: _exportSupportBundle,
  });
}

// --- Exception handlers ---
process.on("uncaughtException", (error) => {
  _logStartup("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  _logStartup("Unhandled rejection", error);
});

// --- Open URL / Open File handlers ---
app.on("open-url", (event, url) => {
  try {
    event.preventDefault();
  } catch {
    // ignore
  }

  if (!url) return;
  if (!appReadyForOpenEvents) {
    pendingOpenUrls.push(url);
    return;
  }
  void handleOpenUrl(url);
});

app.on("open-file", (event, filePath) => {
  try {
    event.preventDefault();
  } catch {
    // ignore
  }

  if (!filePath) return;
  if (!appReadyForOpenEvents) {
    pendingOpenFiles.push(filePath);
    return;
  }
  void handleOpenFile(filePath);
});

// Chromium-level hardening to reduce background network traffic.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-translate");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("safebrowsing-disable-auto-update");

// --- Remaining functions that stay in main.js (they have complex cross-cutting state) ---

async function handleOpenUrl(_url) {
  // Legacy activation code URL handling removed. Placeholder for future deep-link support.
}

async function handleOpenFile(_filePath) {
  // Legacy .otto-license file handling removed.
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getLocalServerOrigin() {
  const protocol = app.isPackaged ? "https" : "http";
  const port = process.env.PORT || "5150";
  return `${protocol}://127.0.0.1:${port}`;
}

function getSetupClientName() {
  const hostname = String(os.hostname() || "").trim();
  return hostname || "Client computer";
}

function normalizeSmsRecipient(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  return raw.replace(/[^\d+,;]/g, "");
}

function buildSmsUris(phone, message) {
  const recipient = normalizeSmsRecipient(phone);
  const body = encodeURIComponent(String(message || "").trim());
  if (!recipient) return [];

  const withQuery = body ? `sms:${recipient}?body=${body}` : `sms:${recipient}`;
  const withAmp = body ? `sms:${recipient}&body=${body}` : `sms:${recipient}`;
  return Array.from(new Set([withQuery, withAmp]));
}

async function openSmsDraft(payload) {
  const recipient = normalizeSmsRecipient(payload?.phone);
  const message = String(payload?.message || "").trim();

  if (!recipient) {
    return { ok: false, message: "A patient phone number is required to draft an SMS." };
  }
  if (!message) {
    return { ok: false, message: "Message text is empty." };
  }

  const uris = buildSmsUris(recipient, message);
  if (uris.length === 0) {
    return { ok: false, message: "Could not build an SMS draft link." };
  }

  let lastError = null;
  for (const uri of uris) {
    try {
      await shell.openExternal(uri);
      return { ok: true, uri };
    } catch (error) {
      lastError = error;
    }
  }

  return { ok: false, message: String(lastError?.message || lastError || "Could not open SMS app.") };
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
  const result = await requestJsonWithFingerprint(healthUrl.toString(), {
    expectedPairingCode: pairingCode,
    allowMissingFingerprint: true,
    timeoutMs: 5000,
  });

  if (!result.ok) {
    if (result.status === 495) {
      return {
        ok: false,
        message: "Pairing code does not match this Host. Check the code from the Host computer.",
      };
    }
    if (result.status === 496) {
      return {
        ok: false,
        message: "Could not read the Host certificate. Please retry from this screen.",
      };
    }
    if (!result.status) {
      return {
        ok: false,
        message: `Could not connect: ${result?.error || "Unknown error"}`,
      };
    }
    return {
      ok: false,
      message:
        result?.json?.error ||
        result?.json?.message ||
        result?.error ||
        `Host responded with ${result.status || "an error"}.`,
    };
  }

  if (result?.json?.ok !== true) {
    return { ok: false, message: "Host computer responded unexpectedly. Please try again." };
  }

  const certificateVerified = !isHttps || Boolean(result.fingerprintHex);
  return {
    ok: true,
    message: certificateVerified
      ? "Connection successful."
      : "Connection successful. Waiting for Host computer approval\u2026",
  };
}

async function probeHostForDiscovery({ protocol, port, host, pairingHex }) {
  const origin = `${protocol}://${host}:${port}`;
  const setupUrl = new URL("/api/setup/status", origin).toString();
  const setupResult = await requestJsonWithFingerprint(setupUrl);

  let setupJson = null;
  if (setupResult.ok && setupResult.json && typeof setupResult.json === "object") {
    setupJson = setupResult.json;
  } else {
    const healthUrl = new URL("/api/health", origin).toString();
    const healthResult = await requestJsonWithFingerprint(healthUrl);
    const healthOk = healthResult.ok && healthResult.json && healthResult.json.ok === true;
    if (!healthOk) return null;
    if (!setupResult.fingerprintHex && healthResult.fingerprintHex) {
      setupResult.fingerprintHex = healthResult.fingerprintHex;
    }
  }

  const fingerprintHex = normalizeFingerprint256Hex(setupResult.fingerprintHex);
  if (protocol === "https") {
    if (!fingerprintHex) return null;
    if (pairingHex && !fingerprintHex.startsWith(pairingHex)) return null;
  }

  const officeName = typeof setupJson?.officeName === "string" ? setupJson.officeName.trim() : "";
  const initialized = Boolean(setupJson?.initialized);
  const pairingCode = protocol === "https" ? pairingCodeFromFingerprintHex(fingerprintHex) : "";

  return {
    url: origin,
    protocol,
    host,
    port: Number(port) || 0,
    officeName,
    initialized,
    pairingCode,
    fingerprint256: protocol === "https" ? formatFingerprint256(fingerprintHex) : "",
  };
}

async function discoverHosts(payload) {
  const input = payload && typeof payload === "object" ? payload : {};
  const defaultPort = Number(process.env.PORT) || 5150;
  let protocol = "https";
  let port = defaultPort;
  let preferredHost = "";

  const normalizedHostUrl = normalizeDiscoveryHostUrl(input.hostUrl);
  if (normalizedHostUrl) {
    try {
      const parsed = new URL(normalizedHostUrl);
      preferredHost = parsed.hostname || "";
      protocol = parsed.protocol === "http:" ? "http" : "https";
      const parsedPort = Number(parsed.port);
      port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : protocol === "https" ? 443 : 80;
    } catch {
      // ignore invalid input and fall back to subnet scan defaults
    }
  }

  const payloadProtocol = String(input.protocol || "").toLowerCase();
  if (payloadProtocol === "http" || payloadProtocol === "https") {
    protocol = payloadProtocol;
  }

  const payloadPort = Number(input.port);
  if (Number.isFinite(payloadPort) && payloadPort > 0 && payloadPort <= 65535) {
    port = payloadPort;
  }

  const pairingHex = normalizePairingCodeHex(input.pairingCode || "");
  const candidates = [];
  const seenHosts = new Set();
  const pushCandidate = (host) => {
    const normalized = String(host || "").trim();
    if (!normalized || seenHosts.has(normalized)) return;
    seenHosts.add(normalized);
    candidates.push(normalized);
  };

  if (preferredHost) pushCandidate(preferredHost);
  for (const host of getLocalSubnetHostCandidates()) {
    pushCandidate(host);
  }
  if (candidates.length === 0) {
    pushCandidate("127.0.0.1");
    pushCandidate("localhost");
  }

  const startedAt = Date.now();
  const discovered = await mapWithConcurrency(candidates, HOST_DISCOVERY_CONCURRENCY, async (host) => {
    try {
      return await probeHostForDiscovery({ protocol, port, host, pairingHex });
    } catch {
      return null;
    }
  });

  const byUrl = new Map();
  for (const item of discovered) {
    if (item && !byUrl.has(item.url)) {
      byUrl.set(item.url, item);
    }
  }

  const hosts = Array.from(byUrl.values()).sort((a, b) => {
    if (a.host === preferredHost && b.host !== preferredHost) return -1;
    if (b.host === preferredHost && a.host !== preferredHost) return 1;
    if (a.initialized !== b.initialized) return a.initialized ? -1 : 1;
    if (a.officeName && b.officeName && a.officeName !== b.officeName) {
      return a.officeName.localeCompare(b.officeName);
    }
    return a.host.localeCompare(b.host);
  });

  return {
    ok: true,
    protocol,
    port,
    scanMs: Date.now() - startedAt,
    hosts,
  };
}

function maybeRestoreDatabaseFromArgs() {
  const idx = process.argv.indexOf("--restore");
  if (idx === -1) return;

  const restoreFrom = process.argv[idx + 1];
  if (!restoreFrom) return;

  const sqlitePath = _getSqlitePath();
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
    console.error("Restore failed:", error);
  }
}

let hostServerStarted = false;
async function maybeStartHostServer() {
  const config = _readConfig();
  if (config.mode !== "host") return;
  if (hostServerStarted) return;

  if (!app.isPackaged) return;

  if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

  const repoRoot = path.resolve(__dirname, "..");
  const serverEntry = path.join(repoRoot, "dist", "index.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server build not found at ${serverEntry}. Run \`npm run build\` first.`);
  }

  hostServerStarted = true;
  void import(pathToFileURL(serverEntry).href).catch(async (error) => {
    hostServerStarted = false;
    _logStartup("Host server failed to start", error);
    try {
      await dialog.showMessageBox({
        type: "error",
        message: "The Host server failed to start",
        detail:
          "Otto Tracker couldn't start its local server.\n\n" +
          "Most common causes:\n" +
          "\u2022 The SQLite module failed to load\n" +
          "\u2022 Port 5150 is already in use\n" +
          "\u2022 The app doesn't have permission to write its data folder\n\n" +
          `Log file:\n${_getStartupLogPath()}`,
      });
    } catch {
      // ignore
    }
    app.quit();
  });
}

// Per-session mutable set of allowed host:port strings (updated when server starts).
const sessionAllowedHostPorts = new Map();

function addAllowedOriginForSession(electronSession, origin) {
  if (!origin) return;
  try {
    const url = new URL(origin);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const hostPort = `${url.hostname}:${port}`;
    let set = sessionAllowedHostPorts.get(electronSession);
    if (!set) {
      set = new Set();
      sessionAllowedHostPorts.set(electronSession, set);
    }
    set.add(hostPort);
  } catch {}
}

function setupNoInternetNetworkGuard(electronSession, allowedOrigin) {
  if (guardedSessions.has(electronSession)) return;
  guardedSessions.add(electronSession);

  addAllowedOriginForSession(electronSession, allowedOrigin);

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
      const allowed = sessionAllowedHostPorts.get(electronSession);
      if (allowed && allowed.has(hostPort)) {
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
      const tls = _getHostTlsInfo();
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

          const certFpHex = fingerprintHexFromCertificate(request?.certificate);
          if (!certFpHex) return callback(-3);

          if (current.fingerprintHex && certFpHex && certFpHex === current.fingerprintHex) {
            return callback(0);
          }

          if (current.mode === "client" && current.pairingCodeHex && certFpHex) {
            if (certFpHex.startsWith(current.pairingCodeHex)) {
              try {
                const cfg = _readConfig();
                if (cfg.mode === "client") {
                  const formatted =
                    typeof request?.certificate?.fingerprint256 === "string"
                      ? request.certificate.fingerprint256
                      : formatFingerprint256(certFpHex);
                  if (normalizeHex(cfg.trustedFingerprint256) !== certFpHex) {
                    _writeConfig({ ...cfg, trustedFingerprint256: formatted });
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

    const certFpHex = fingerprintHexFromCertificate(certificate);
    if (!certFpHex) return callback(false);

    if (trust.fingerprintHex && certFpHex === trust.fingerprintHex) {
      event.preventDefault();
      return callback(true);
    }

    if (trust.mode === "client" && trust.pairingCodeHex && certFpHex.startsWith(trust.pairingCodeHex)) {
      try {
        const current = _readConfig();
        if (current.mode === "client") {
          const formatted =
            typeof certificate?.fingerprint256 === "string"
              ? certificate.fingerprint256
              : formatFingerprint256(certFpHex);

          if (normalizeHex(current.trustedFingerprint256) !== certFpHex) {
            _writeConfig({ ...current, trustedFingerprint256: formatted });
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
    message: "The Host server didn't start",
    detail:
      "Otto Tracker couldn't reach its local server after 30 seconds.\n\n" +
      "Most common causes:\n" +
      "\u2022 The SQLite module failed to load\n" +
      "\u2022 Port 5150 is already in use\n" +
      "\u2022 The app doesn't have permission to write its data folder\n\n" +
      `Log file:\n${_getStartupLogPath()}`,
  });

  if (response === 1) {
    shell.showItemInFolder(_getStartupLogPath());
  } else if (response === 2) {
    app.quit();
  }

  return response;
}

async function launchMainWindowForConfig(config, options = {}) {
  const showBootWindow = options?.showBootWindow !== false;
  _setAppMenu(config);

  let bootWindow = null;
  if (config.mode === "host" && showBootWindow) {
    bootWindow = _createBootWindow();
  }

  try {
    if (config.mode === "host") {
      applyLicenseEgressAllowlist();
    }

    if (config.mode === "host" && app.isPackaged) {
      _applyHostTlsEnv();
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
        return false;
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
          return false;
        }
        readiness = await waitForHostReady({
          protocol,
          host: "127.0.0.1",
          port,
          timeoutMs: 30000,
        });
      }
    }

    const targetUrl = _getTargetUrlForConfig(config);
    _createWindow(targetUrl, config);

    if (config.mode === "host") {
      await _maybePromptForBackupFolder();
      await _maybeWarnAboutBackups();
      _scheduleAutomaticBackups();
    }

    return true;
  } finally {
    if (bootWindow && !bootWindow.isDestroyed()) {
      bootWindow.close();
    }
  }
}

// --- Portal functions ---

async function portalFindHost(payload) {
  const { email, password } = payload || {};
  if (!email || !password) {
    return { ok: false, message: "Email and password are required." };
  }

  const base = getPortalBaseUrl();
  const url = new URL("/portal/api/auth/desktop-token", base);

  try {
    const body = JSON.stringify({ email, password });
    const result = await new Promise((resolve, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, json });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Portal request timed out."));
      });
      req.write(body);
      req.end();
    });

    if (result.status === 401) {
      return { ok: false, message: "Invalid email or password." };
    }

    if (result.status === 404) {
      return { ok: false, message: "Portal does not support host discovery. Use Auto-detect or Manual entry." };
    }

    if (result.status < 200 || result.status >= 300) {
      const msg = result.json?.error || result.json?.message || `Portal returned status ${result.status}`;
      return { ok: false, message: String(msg) };
    }

    const json = result.json;
    if (!json || !Array.isArray(json.offices)) {
      return { ok: false, message: "Unexpected response from portal." };
    }

    const hosts = json.offices
      .filter((o) => o && o.host)
      .map((o) => ({
        officeId: o.officeId || o.portalOfficeId || "",
        officeName: o.officeName || o.name || "",
        role: o.role || "",
        localAddresses: Array.isArray(o.host.localAddresses) ? o.host.localAddresses : [],
        pairingCode: o.host.pairingCode || "",
        tlsFingerprint256: o.host.tlsFingerprint256 || "",
        lastCheckinAt: o.host.lastCheckinAt || 0,
      }));

    return { ok: true, hosts };
  } catch (err) {
    const isTimeout = err && err.message && err.message.includes("timed out");
    return {
      ok: false,
      message: isTimeout
        ? "Can't reach portal. Use Auto-detect or Manual entry instead."
        : "Could not connect to portal. Check internet access and try again.",
    };
  }
}

async function portalDesktopAuth(payload) {
  const { email, password } = payload || {};
  if (!email || !password) {
    return { ok: false, message: "Email and password are required." };
  }

  const base = getPortalBaseUrl();
  const url = new URL("/portal/api/auth/desktop-token", base);

  try {
    const body = JSON.stringify({ email, password });
    const result = await new Promise((resolve, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, json });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Portal request timed out."));
      });
      req.write(body);
      req.end();
    });

    if (result.status === 401) {
      return { ok: false, message: "Invalid email or password." };
    }

    if (result.status < 200 || result.status >= 300) {
      const msg = result.json?.error || result.json?.message || `Portal returned status ${result.status}`;
      return { ok: false, message: String(msg) };
    }

    const json = result.json;
    if (!json) {
      return { ok: false, message: "Unexpected response from portal." };
    }

    const token = json.token || "";
    const expiresAt = json.expiresAt || 0;

    const user = json.user && typeof json.user === "object" ? json.user : null;

    const offices = Array.isArray(json.offices)
      ? json.offices.map((o) => ({
          officeId: o.officeId || o.portalOfficeId || o.id || "",
          officeName: o.officeName || o.name || "",
          role: o.role || "",
          address: o.address || null,
          phone: o.phone || null,
          email: o.email || null,
          subscriptionStatus: o.subscriptionStatus || null,
        }))
      : [];

    if (!token) {
      return { ok: false, message: "Portal did not return an authentication token." };
    }

    return {
      ok: true,
      token,
      expiresAt,
      offices,
      firstName: user?.firstName || null,
      lastName: user?.lastName || null,
      email: user?.email || null,
    };
  } catch (err) {
    const isTimeout = err && err.message && err.message.includes("timed out");
    return {
      ok: false,
      message: isTimeout
        ? "Can't reach the Otto portal. Check internet access and try again."
        : "Could not connect to portal. Check internet access and try again.",
    };
  }
}

async function portalValidateInviteCodeDesktop(payload) {
  const { inviteCode } = payload || {};
  if (!inviteCode || !/^\d{6}$/.test(String(inviteCode).trim())) {
    return { ok: false, message: "Invite code must be 6 digits." };
  }

  const configDir = app.getPath("userData");
  const installationIdPath = path.join(configDir, "installation-id.txt");
  let installationId;
  try {
    installationId = fs.readFileSync(installationIdPath, "utf-8").trim();
  } catch {
    installationId = "";
  }
  if (!installationId) {
    installationId = crypto.randomBytes(16).toString("hex");
    try {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(installationIdPath, installationId, { mode: 0o600 });
    } catch {
      // Non-fatal
    }
  }

  const base = getPortalBaseUrl();
  const url = new URL("/portal/api/invite-codes/validate", base);

  try {
    const body = JSON.stringify({ inviteCode: String(inviteCode).trim(), installationId });
    const result = await new Promise((resolve, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, json });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Portal request timed out."));
      });
      req.write(body);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      const msg = result.json?.error || result.json?.message || "Invalid invite code.";
      return { ok: false, message: String(msg) };
    }

    if (!result.json?.valid) {
      return { ok: false, message: result.json?.message || "Invalid or expired invite code. Ask your manager to check the invite code in Settings." };
    }

    return {
      ok: true,
      officeName: String(result.json.officeName || ""),
      officeId: String(result.json.officeId || ""),
      installationId,
    };
  } catch (err) {
    const isTimeout = err && err.message && err.message.includes("timed out");
    return {
      ok: false,
      message: isTimeout
        ? "Can't reach the Otto portal. Check internet access and try again."
        : "Could not connect to portal. Check internet access and try again.",
    };
  }
}

// --- IPC Handlers ---

ipcMain.handle("otto:config:get", async () => _readConfig());
ipcMain.handle("otto:config:set", async (_event, configInput) => {
  const hadConfigFileBeforeWrite = fs.existsSync(_getConfigPath());
  const previous = _readConfig();
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

  _writeConfig(config);

  const isFirstTimeSetup = !hadConfigFileBeforeWrite || (setupWindow && !setupWindow.isDestroyed());

  if (isFirstTimeSetup) {
    if (config.mode === "host") {
      const protocol = app.isPackaged ? "https" : "http";
      const port = process.env.PORT || "5150";
      try {
        applyLicenseEgressAllowlist();
        if (app.isPackaged) {
          _applyHostTlsEnv();
        }

        const numPort = Number(port);
        const portFree = await isPortAvailable(numPort, "0.0.0.0");
        if (!portFree) {
          return {
            ok: false,
            relaunched: false,
            message: `Port ${port} is already in use. Please close the other app or restart your computer and try again.`,
          };
        }

        await maybeStartHostServer();
        const readiness = await waitForHostReady({ protocol, host: "127.0.0.1", port, timeoutMs: 45000 });
        if (!readiness.ok) {
          return { ok: false, relaunched: false, message: "Server did not start in time. Please close Otto and try again." };
        }
      } catch (err) {
        return { ok: false, relaunched: false, message: "Could not start the server." };
      }
      const serverBaseUrl = `${protocol}://127.0.0.1:${port}`;

      if (setupWindow && !setupWindow.isDestroyed()) {
        addAllowedOriginForSession(setupWindow.webContents.session, serverBaseUrl);
        registerTlsTrustForWindow(setupWindow, serverBaseUrl, config);
      }

      return { ok: true, relaunched: false, serverBaseUrl };
    }

    const launched = await launchMainWindowForConfig(config, { showBootWindow: false });
    if (!launched) {
      return {
        ok: false,
        relaunched: false,
        message: "Could not start Otto Tracker with the selected setup. Please review your details and try again.",
      };
    }
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close();
    }
    return { ok: true, relaunched: false };
  }

  app.relaunch();
  app.exit(0);
  return { ok: true, relaunched: true };
});

ipcMain.handle("otto:setup:bootstrap", async (_event, payload) => {
  const config = _readConfig();
  const protocol = app.isPackaged ? "https" : "http";
  const port = process.env.PORT || "5150";
  const url = `${protocol}://127.0.0.1:${port}/api/setup/bootstrap`;

  try {
    const mod = protocol === "https" ? https : http;
    const body = JSON.stringify(payload);
    const result = await new Promise((resolve, reject) => {
      const req = mod.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30000,
        rejectUnauthorized: false,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.on("timeout", () => { req.destroy(); reject(new Error("Bootstrap request timed out.")); });
      req.write(body);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      const error = result.json?.error || `Setup failed (${result.status})`;
      const code = result.json?.code || "";
      return { ok: false, error, code, status: result.status };
    }

    return { ok: true, data: result.json };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach the local server." };
  }
});

ipcMain.handle("otto:setup:pick-snapshot", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select backup snapshot",
    properties: ["openFile"],
    filters: [{ name: "JSON Snapshot", extensions: ["json"] }],
    defaultPath: app.getPath("documents"),
  });

  if (canceled || filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const raw = fs.readFileSync(filePaths[0], "utf-8");
    const snapshot = JSON.parse(raw);
    const fileName = path.basename(filePaths[0]);
    return { ok: true, snapshot, fileName };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not read snapshot file." };
  }
});

ipcMain.handle("otto:setup:import-snapshot", async (_event, payload) => {
  const config = _readConfig();
  const protocol = app.isPackaged ? "https" : "http";
  const port = process.env.PORT || "5150";
  const url = `${protocol}://127.0.0.1:${port}/api/setup/import-snapshot`;

  try {
    const mod = protocol === "https" ? https : http;
    const body = JSON.stringify(payload);
    const result = await new Promise((resolve, reject) => {
      const req = mod.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 60000,
        rejectUnauthorized: false,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.on("timeout", () => { req.destroy(); reject(new Error("Import request timed out.")); });
      req.write(body);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      const error = result.json?.error || `Import failed (${result.status})`;
      const code = result.json?.code || "";
      return { ok: false, error, code, status: result.status };
    }

    return { ok: true, data: result.json };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach the local server." };
  }
});

ipcMain.handle("otto:setup:complete", async () => {
  const config = _readConfig();
  _setAppMenu(config);
  const targetUrl = _getTargetUrlForConfig(config);
  _createWindow(targetUrl, config);

  if (config.mode === "host") {
    await _maybePromptForBackupFolder();
    await _maybeWarnAboutBackups();
    _scheduleAutomaticBackups();
  }

  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
  }
  return { ok: true };
});

ipcMain.handle("otto:connection:test", async (_event, payload) => {
  const hostUrl = payload?.hostUrl;
  const pairingCode = payload?.pairingCode;
  return await testHostConnection(hostUrl, pairingCode);
});

ipcMain.handle("otto:hosts:discover", async (_event, payload) => {
  return await discoverHosts(payload);
});

ipcMain.handle("otto:window:set-min-width", async (event, requestedWidth) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const targetWindow =
    senderWindow && mainWindow && senderWindow.id === mainWindow.id ? mainWindow : mainWindow || senderWindow;
  if (!targetWindow) {
    return { ok: false, message: "Main window is not available." };
  }
  return setMainWindowMinWidth(targetWindow, requestedWidth);
});

ipcMain.handle("otto:hostAddresses:show", async () => {
  await _showHostAddresses();
  return { ok: true };
});

ipcMain.handle("otto:hostInfo:get", async () => {
  return _computeHostInfo();
});

ipcMain.handle("otto:outbox:get", async () => {
  return _readOutboxItems();
});

ipcMain.handle("otto:outbox:replace", async (_event, items) => {
  _writeOutboxItems(items);
  return { ok: true };
});

ipcMain.handle("otto:outbox:clear", async () => {
  _writeOutboxItems([]);
  return { ok: true };
});

ipcMain.handle("otto:diagnostics:show", async () => {
  await _showDiagnostics();
  return { ok: true };
});

ipcMain.handle("otto:supportBundle:export", async () => {
  await _exportSupportBundle();
  return { ok: true };
});

ipcMain.handle("otto:sms:draft:open", async (_event, payload) => {
  return await openSmsDraft(payload || {});
});

ipcMain.handle("otto:portal:find-host", async (_event, payload) => {
  return await portalFindHost(payload);
});

ipcMain.handle("otto:portal:desktop-auth", async (_event, payload) => {
  return await portalDesktopAuth(payload);
});

ipcMain.handle("otto:portal:validate-invite-code", async (_event, payload) => {
  try {
    const result = await portalValidateInviteCodeDesktop(payload);
    return result;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    _logStartup("validate-invite-code IPC error", msg, err && err.stack);
    return { ok: false, message: `Internal error: ${msg}` };
  }
});

// --- App lifecycle ---

app.whenReady().then(async () => {
  loadDevDotEnv(app);
  migrateLegacyUserDataDir(app);
  applyOfflineDefaultsRaw(app);
  ensureSessionSecret(app);
  maybeRestoreDatabaseFromArgs();
  _logStartup("App starting");

  appReadyForOpenEvents = true;
  for (const url of pendingOpenUrls.splice(0)) {
    await handleOpenUrl(url);
  }
  for (const filePath of pendingOpenFiles.splice(0)) {
    await handleOpenFile(filePath);
  }
  for (const arg of process.argv) {
    if (typeof arg === "string" && (arg.startsWith("otto:") || arg.startsWith("otto-desktop:"))) {
      await handleOpenUrl(arg);
    }
    if (typeof arg === "string" && arg.toLowerCase().endsWith(".otto-license")) {
      await handleOpenFile(arg);
    }
  }

  const hasConfigFile = fs.existsSync(_getConfigPath());
  if (!hasConfigFile) {
    _setAppMenu(getDefaultConfig());
    _createSetupWindow();
    return;
  }

  const config = _readConfig();
  await launchMainWindowForConfig(config, { showBootWindow: true });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    const server = globalThis.__ottoServer;
    if (server && typeof server.close === "function") {
      server.close();
      globalThis.__ottoServer = null;
    }
  } catch {
    // best-effort
  }
});

app.on("second-instance", (_event, argv) => {
  if (appReadyForOpenEvents && Array.isArray(argv)) {
    void (async () => {
      for (const arg of argv) {
        if (typeof arg === "string" && (arg.startsWith("otto:") || arg.startsWith("otto-desktop:"))) {
          await handleOpenUrl(arg);
        }
        if (typeof arg === "string" && arg.toLowerCase().endsWith(".otto-license")) {
          await handleOpenFile(arg);
        }
      }
    })();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const hasConfigFile = fs.existsSync(_getConfigPath());
  if (!hasConfigFile) {
    _setAppMenu(getDefaultConfig());
    _createSetupWindow();
    return;
  }

  const config = _readConfig();
  void launchMainWindowForConfig(config, { showBootWindow: false });
});
