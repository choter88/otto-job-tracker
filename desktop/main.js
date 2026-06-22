// Sentry must be initialized before all other imports to capture early errors.
import { initSentryMain, setSentryAppMode, Sentry } from "./lib/sentry.js";
import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, safeStorage, screen, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { initAutoUpdater, stopAutoUpdater, checkForUpdatesManual, installUpdate as installUpdateRaw, getUpdateState, onUpdateStateChange, onUpdateReadyAtLaunch } from "./lib/auto-updater.js";

// --- Module imports ---
import {
  getStartupLogPath,
  logStartup,
  migrateLegacyUserDataDir,
  getErrorLogPath,
  loadDevDotEnv,
  getDefaultConfig,
  setupState,
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
  restoreAttachmentsFromBackup,
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

import { isAlwaysOnHostCapable, shouldStartHostServer, isResidentApp, residentToggleField, residentCopy } from "./lib/always-on.js";
import { parseHostPort, probeHost } from "./lib/host-probe.js";

import { buildUpdateInstallPrompt } from "./lib/update-prompt.js";

import { createOrderSheetWatcher } from "./lib/order-sheet-watcher.js";

// --- Constants ---
const APP_DISPLAY_NAME = "Otto Tracker";

// Initialize Sentry as early as possible (before any async work).
// SENTRY_DSN may be set via .env (loaded later for dev) or baked in at build time.
// If unset, initSentryMain silently no-ops.
initSentryMain({ appVersion: app.getVersion() });

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
let orderSheetWatcher = null;
// Always-on host (Workstream A). tray is created only when always-on is active
// (Host mode + OTTO_ALWAYS_ON_HOST capability + not opted out); it stays null in
// production so nothing changes there.
let tray = null;
let hiddenToTrayNoticeShown = false;
// Set while an update install is driving the quit (Phase 2). Tells before-quit
// to step aside so electron-updater's quitAndInstall can install + relaunch,
// instead of the host path's app.exit(0) which would skip the install.
let updateInstallInProgress = false;
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

// True only when first-run setup actually finished — NOT just because a config
// file exists (setup writes one mid-flow). An abandoned setup leaves an
// "incomplete" config and should re-open to the setup window. Legacy configs
// (written before the flag existed) are assumed complete and stamped on read.
function _isSetupComplete() {
  if (!fs.existsSync(_getConfigPath())) return false;
  const config = _readConfig();
  const state = setupState(config);
  if (state === "legacy") {
    _writeConfig({ ...config, setupComplete: true });
    return true;
  }
  return state === "complete";
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

let runBackupNowInFlight = null;

async function _runBackupNow() {
  if (runBackupNowInFlight) return runBackupNowInFlight;

  runBackupNowInFlight = (async () => {
    const before = _readConfig();
    if (before.mode !== "host") {
      throw new Error("Backups only run on the Host computer.");
    }

    const localTargeted = before.localBackupEnabled !== false;
    const networkTargeted = before.backupEnabled !== false && Boolean(before.backupDir);
    if (!localTargeted && !networkTargeted) {
      throw new Error("No backup folder is configured.");
    }

    const beforeLocalAt = Number(before.localBackupLastAt) || 0;
    const beforeNetworkAt = Number(before.backupLastAt) || 0;

    await Promise.all([
      _runBackupToLocalFolder({ interactive: false, reason: "manual" }),
      _runBackupToNetworkFolder({ interactive: false, reason: "manual" }),
    ]);

    const after = _readConfig();
    const localSucceeded = (Number(after.localBackupLastAt) || 0) > beforeLocalAt;
    const networkSucceeded = (Number(after.backupLastAt) || 0) > beforeNetworkAt;

    if (!localSucceeded && !networkSucceeded) {
      const errors = [];
      if (localTargeted && after.localBackupLastError) errors.push(`Local: ${after.localBackupLastError}`);
      if (networkTargeted && after.backupLastError) errors.push(`Network: ${after.backupLastError}`);
      throw new Error(errors.join("; ") || "Backup failed");
    }

    const result = { backupAt: new Date().toISOString() };
    if (localSucceeded) result.localPath = after.localBackupLastPath;
    if (networkSucceeded) result.networkPath = after.backupLastPath;
    return result;
  })();

  try {
    return await runBackupNowInFlight;
  } finally {
    runBackupNowInFlight = null;
  }
}

globalThis.__ottoRunBackupNow = _runBackupNow;

async function _runShutdownBackup() {
  const config = _readConfig();
  if (config.mode !== "host") return;

  // Cap the wait so a wedged network folder can't trap a user trying to quit.
  // Both writers swallow their own errors; if the backup is still running
  // when we hit the timeout, app.exit(0) below will tear it down.
  const SHUTDOWN_BACKUP_TIMEOUT_MS = 10_000;
  const work = Promise.all([
    _runBackupToLocalFolder({ interactive: false, reason: "shutdown" }).catch(() => {}),
    _runBackupToNetworkFolder({ interactive: false, reason: "shutdown" }).catch(() => {}),
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_BACKUP_TIMEOUT_MS));
  await Promise.race([work, timeout]);
}

async function _resetHost() {
  const confirm = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Reset Host", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Reset this Host?",
    detail:
      "This will delete all data on this computer and return to the setup screen.\n\n" +
      "Local backups in Documents are NOT deleted.\n\n" +
      "This cannot be undone.",
  });

  if (confirm.response !== 0) return;

  // Second confirmation for safety
  const doubleConfirm = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Yes, delete everything", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Are you sure?",
    detail: "All jobs, settings, and user accounts on this Host will be permanently deleted.",
  });

  if (doubleConfirm.response !== 0) return;

  try {
    // Delete database + WAL/SHM files
    const sqlitePath = _getSqlitePath();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = sqlitePath + suffix;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
    }

    // Delete session database
    const dataDir = process.env.OTTO_DATA_DIR || path.join(app.getPath("home"), ".otto-job-tracker");
    const sessionDbPath = path.join(dataDir, "sessions.sqlite");
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = sessionDbPath + suffix;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
    }

    // Reset config to fresh state (keeps backup settings)
    const config = _readConfig();
    _writeConfig({
      ...config,
      mode: "",
      hostToken: "",
      activationCode: "",
      trustedFingerprint256: "",
    });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Reset failed",
      detail: `${error?.message || error}\n\nYou may need to manually delete the app data folder.`,
    });
    return;
  }

  // Relaunch into setup
  app.relaunch();
  app.exit(0);
}

// Non-destructive recovery: clears the cached license *status* that can get
// stuck (e.g. a stale "disabled"/"trial expired" left over after a portal-side
// change, or after a stretch of failed check-ins) without touching the host
// token, identity, or any jobs/users/settings. The Host then restarts and the
// startup check-in re-evaluates the license from scratch.
async function _repairLicense() {
  const confirm = await dialog.showMessageBox({
    type: "question",
    buttons: ["Repair License", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Repair this Host's license?",
    detail:
      "This re-checks your subscription with the Otto portal. Your data — jobs, " +
      "users, and settings — is NOT touched.\n\n" +
      "Use this if Otto is stuck showing read-only or \"trial expired\" after your " +
      "subscription or trial was updated.\n\n" +
      "Otto will restart to reconnect.",
  });

  if (confirm.response !== 0) return;

  try {
    const dataDir = process.env.OTTO_DATA_DIR || path.join(app.getPath("home"), ".otto-job-tracker");
    const licensePath = path.join(dataDir, "license.json");

    if (fs.existsSync(licensePath)) {
      const state = JSON.parse(fs.readFileSync(licensePath, "utf-8"));
      // Clear only the cached status flags that can strand a Host. Keep the host
      // token, installation identity, check-in timing, and office id so this
      // stays non-destructive and does not require re-activation.
      delete state.officeStatus;
      delete state.paymentRequired;
      state.lastError = "";
      state.tokenInvalid = false;
      fs.writeFileSync(licensePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Repair failed",
      detail: `${error?.message || error}\n\nTry Diagnostics, or contact support.`,
    });
    return;
  }

  // Relaunch so the startup check-in re-evaluates the license from scratch.
  app.relaunch();
  app.exit(0);
}

function _scheduleAutomaticBackups() {
  scheduleAutomaticBackupsRaw({
    readConfig: _readConfig,
    runLocalBackup: _runBackupToLocalFolder,
    runNetworkBackup: _runBackupToNetworkFolder,
    getLocalBackupDir: _getLocalBackupDir,
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

// Client offline recovery. An in-window reload cannot recover a wedged
// connection (only a fresh process does — the user's quit+reopen). So when a
// CLIENT window fails to load, we probe the host from the MAIN process (a raw
// TCP connect, independent of the renderer) and, once it actually answers,
// relaunch the client — the automated equivalent of quit+reopen. Clients are
// stateless, so relaunching is safe.
const RECONNECT_RELAUNCH_ARG = "--otto-reconnect-relaunches=";
const MAX_RECONNECT_RELAUNCHES = 3;
let clientReconnectTimer = null;
let clientReconnectAttempt = 0;
// Consecutive auto-relaunches that have NOT yet led to a good connection.
// Seeded from the relaunch arg so it survives the restart (in-memory state dies
// with the process); reset to 0 on a successful load or an explicit "Try now".
// Bounds a restart storm if relaunching somehow fails to recover.
let reconnectRelaunchChain = (() => {
  try {
    const a = process.argv.find((x) => typeof x === "string" && x.startsWith(RECONNECT_RELAUNCH_ARG));
    const n = a ? Number(a.slice(RECONNECT_RELAUNCH_ARG.length)) : 0;
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
})();

function _stopClientReconnectWatch() {
  if (clientReconnectTimer) { clearTimeout(clientReconnectTimer); clientReconnectTimer = null; }
  clientReconnectAttempt = 0;
}

function _relaunchClientToReconnect() {
  try {
    const args = process.argv
      .slice(1)
      .filter((a) => typeof a === "string" && !a.startsWith(RECONNECT_RELAUNCH_ARG))
      .concat(`${RECONNECT_RELAUNCH_ARG}${reconnectRelaunchChain + 1}`);
    app.relaunch({ args });
    app.exit(0);
  } catch (error) {
    _logStartup("[reconnect] relaunch failed", error);
  }
}

function _startClientReconnectWatch(win, immediate) {
  _logStartup(`[reconnect] watch start immediate=${!!immediate} alreadyWatching=${!!clientReconnectTimer} winIsMain=${win === mainWindow}`); // ponytail: diagnostic, remove once root cause confirmed
  if (clientReconnectTimer && !immediate) return; // already watching
  if (clientReconnectTimer) { clearTimeout(clientReconnectTimer); clientReconnectTimer = null; }
  clientReconnectAttempt = 0;
  if (immediate) reconnectRelaunchChain = 0; // explicit "Try now" — earn fresh relaunches

  const tick = async () => {
    _logStartup(`[reconnect] tick fired (uptime ${Math.round(process.uptime())}s)`); // ponytail: diagnostic, remove once root cause confirmed
    // Only ever act for the CURRENT client window. A stale/superseded window or
    // a host must never reach the relaunch.
    if (!win || win.isDestroyed() || win !== mainWindow || app.__ottoQuitting) {
      _logStartup(`[reconnect] tick bail guard1: win=${!!win} destroyed=${!!(win && win.isDestroyed && win.isDestroyed())} isMain=${win === mainWindow} quitting=${!!app.__ottoQuitting}`); // ponytail: diagnostic
      _stopClientReconnectWatch(); return;
    }
    let config;
    try { config = _readConfig(); } catch (e) { config = null; _logStartup(`[reconnect] tick readConfig threw: ${(e && e.message) || e}`); } // ponytail: diagnostic
    if (!config || config.mode !== "client") {
      _logStartup(`[reconnect] tick bail guard2: mode=${config ? config.mode : "<null>"}`); // ponytail: diagnostic
      _stopClientReconnectWatch(); return;
    }

    const target = _getTargetUrlForConfig(config);
    const hp = parseHostPort(target);
    const reachable = hp ? await probeHost({ host: hp.host, port: hp.port, timeoutMs: 3000 }) : false;
    _logStartup(`[reconnect] probe ${hp ? `${hp.host}:${hp.port}` : target} -> ${reachable ? "reachable" : "down"} (uptime ${Math.round(process.uptime())}s, chain ${reconnectRelaunchChain})`);

    if (win.isDestroyed() || win !== mainWindow || app.__ottoQuitting) { _stopClientReconnectWatch(); return; }

    // Relaunch only when: host actually answers, the process has lived long
    // enough that we won't tight-loop, the window is VISIBLE (don't yank a
    // tray-hidden client back open), and we haven't already burned the relaunch
    // budget without recovering.
    if (reachable && process.uptime() > 8 && win.isVisible()) {
      if (reconnectRelaunchChain >= MAX_RECONNECT_RELAUNCHES) {
        _logStartup(`[reconnect] reachable but ${reconnectRelaunchChain} relaunches did not recover — leaving offline page; use Try now`);
        _stopClientReconnectWatch();
        return;
      }
      _logStartup("[reconnect] host reachable — relaunching client to reconnect");
      _stopClientReconnectWatch();
      _relaunchClientToReconnect();
      return;
    }

    clientReconnectAttempt++;
    const delay = Math.min(15000, 2000 * Math.pow(1.5, Math.min(clientReconnectAttempt, 10)));
    clientReconnectTimer = setTimeout(tick, delay);
  };

  // "Try now" probes immediately; a load failure probes shortly after.
  clientReconnectTimer = setTimeout(tick, immediate ? 0 : 1500);
}

// Wired into createWindow: the client window reports load failures / successes.
function _onClientOffline(win, errorCode, errorDescription) {
  _logStartup(`[reconnect] client load failed: ${errorCode} ${errorDescription || ""}`.trim());
  _startClientReconnectWatch(win, false);
}

function _onClientOnline() {
  reconnectRelaunchChain = 0; // a real connection succeeded — reset the relaunch budget
  _stopClientReconnectWatch();
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
    handleMainWindowClose: _handleMainWindowClose,
    onClientOffline: _onClientOffline,
    onClientOnline: _onClientOnline,
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
    resetHost: _resetHost,
    repairLicense: _repairLicense,
    createSetupWindow: _createSetupWindow,
    showDiagnostics: _showDiagnostics,
    exportSupportBundle: _exportSupportBundle,
    checkForUpdates: _checkForUpdates,
    installUpdate: _installUpdate,
    getUpdateState,
    alwaysOnHostCapable: isAlwaysOnHostCapable(),
    residentEnabled: isResidentApp(config),
    toggleResidentMode: _toggleResidentMode,
    showUnattendedHostGuide: _showUnattendedHostGuide,
  });
}

// --- Resident app (always-on host + client parity) ---
//
// The functions below gate resident behavior on isResidentApp() — tray,
// close-to-tray, login item, and stay-alive — for BOTH an always-on Host and a
// Client (default-on, per-machine opt-out). It all stays behind the
// OTTO_ALWAYS_ON_HOST capability: when that is unset (production), isResidentApp
// is false, the tray is never created, login items are never touched, and
// window/quit behavior is unchanged. Host-SERVER semantics (shutdown backup,
// connected-client quit warning) gate on config.mode === "host", not this.

// Register (or clear) the per-user "open at login" item so a resident machine
// (Host or Client) comes back up after a reboot or power blip. No elevation:
// macOS uses a Login Item, Windows an HKCU Run entry. Idempotent so a user who
// turns it off manually is not fought.
function _reconcileLoginItem(config) {
  if (!app.isPackaged) return; // never touch real login items in dev
  if (!isAlwaysOnHostCapable()) return; // dark-shipped: stay completely inert
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
  } catch (error) {
    _logStartup("Failed to reconcile login item", error);
  }
}

// Build the tray context menu. Copy branches on mode via residentCopy: a Host
// shows the server status and a live workstation count; a Client shows its
// connection status (no server / no count).
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

// Create the tray icon. Returns the Tray or null if it could not be created;
// callers must treat null as "no tray" and NOT trap the user behind a hidden
// window (close-to-tray only engages when a tray exists).
function createTray() {
  if (tray) return tray;
  try {
    let image = nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.png"));
    if (image.isEmpty()) {
      _logStartup("Tray icon image is empty; skipping tray");
      return null;
    }
    if (process.platform === "darwin") {
      image = image.resize({ width: 18, height: 18 });
    }
    tray = new Tray(image);
    let trayMode = "host";
    try { trayMode = _readConfig().mode || "host"; } catch { /* default host */ }
    tray.setToolTip(residentCopy(trayMode).trayTooltip);
    _updateTrayMenu();
    // On Windows a single click is the expected "reopen" gesture; on macOS the
    // left-click opens the context menu, so wire double-click as a reopen too.
    tray.on("click", () => _showMainWindow());
    tray.on("double-click", () => _showMainWindow());
    return tray;
  } catch (error) {
    _logStartup("Failed to create tray", error);
    tray = null;
    return null;
  }
}

function _destroyTray() {
  try {
    if (tray) tray.destroy();
  } catch {
    // best-effort
  }
  tray = null;
}

function _showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    let config = null;
    try { config = _readConfig(); } catch { /* default null */ }
    // Reopen always reloads: after auto-logout this lands on a fresh login, and
    // it recovers a stale/offline renderer that closing-to-tray left behind.
    const reload = () => {
      try { mainWindow.loadURL(_getTargetUrlForConfig(config || _readConfig()), { extraHeaders: "pragma: no-cache\n" }); } catch { /* ignore */ }
    };
    // Client: the on-close auto-logout clears the (process-scoped, in-memory)
    // session cookie, but clear again right before the reopen reload so a
    // hidden→reopened window can never silently re-validate a session that
    // outlived the logout. This is the Windows fix: the tray reopen reloads,
    // which previously refreshed the still-live rolling session and kept the
    // user signed in. The always-on Host (persist:otto-host) reopens unchanged.
    if (config && config.mode === "client") {
      mainWindow.webContents.session
        .clearStorageData({ storages: ["cookies", "localStorage", "sessionStorage"] })
        .then(reload, reload);
    } else {
      reload();
    }
    mainWindow.show();
    if (process.platform === "darwin" && config && config.mode === "host") app.dock?.show?.();
    mainWindow.focus();
    return;
  }
  // The window was destroyed (not just hidden) — relaunch it from config.
  try {
    const config = _readConfig();
    void launchMainWindowForConfig(config, { showBootWindow: false });
  } catch (error) {
    _logStartup("Failed to reopen main window from tray", error);
  }
}

function _quitFromTray() {
  // Route through the normal before-quit teardown (client-connected warning +
  // shutdown backup). __ottoQuitting tells the close interceptor this is a real
  // quit, not a window-close-to-tray.
  app.__ottoQuitting = true;
  app.quit();
}

// One-shot reassurance the first time the window hides to the tray, so a
// non-technical user doesn't think they closed (and broke) the office server.
function _maybeShowHiddenToTrayNotice() {
  if (hiddenToTrayNoticeShown) return;
  hiddenToTrayNoticeShown = true;
  try {
    if (Notification.isSupported && !Notification.isSupported()) return;
    let noticeMode = "host";
    try { noticeMode = _readConfig().mode || "host"; } catch { /* default host */ }
    new Notification({
      title: "Otto is still running",
      body: residentCopy(noticeMode).hiddenNoticeBody,
    }).show();
  } catch {
    // notifications are best-effort
  }
}

// Called from the main window's "close" event (wired via createWindow). Returns
// true if it handled the close by hiding to tray; false to let the close
// proceed normally (production, client mode, real quit, or no usable tray).
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
  // HIPAA: end the session on hide so reopening requires re-login (shared
  // machines). Ask the renderer to POST /api/logout (server invalidation +
  // audit) while it still has its cookie, then clear the partition's auth
  // state as a backstop in case the renderer is unresponsive/offline.
  try { win.webContents.send("otto:auto-logout"); } catch { /* best-effort */ }
  try {
    const ses = win.webContents.session;
    if (config.mode === "client") {
      // Client: clear immediately (no delay) so a quick tray-reopen can't
      // re-validate the session before the logout lands. _showMainWindow also
      // clears before reload as the deterministic guard.
      ses.clearStorageData({ storages: ["cookies", "localStorage", "sessionStorage"] }).catch(() => { /* best-effort */ });
    } else {
      setTimeout(() => {
        try { ses.clearStorageData({ storages: ["cookies", "localStorage", "sessionStorage"] }); } catch { /* best-effort */ }
      }, 1500);
    }
  } catch { /* best-effort */ }
  _updateTrayMenu();
  _maybeShowHiddenToTrayNotice();
  return true;
}

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

function _showUnattendedHostGuide() {
  const isMac = process.platform === "darwin";
  const steps = isMac
    ? "1. Open System Settings → Users & Groups.\n2. Set “Automatically log in as” to this computer’s user.\n3. Set the display to never sleep (System Settings → Displays / Battery)."
    : "1. Press Win+R, type netplwiz, press Enter.\n2. Uncheck “Users must enter a user name and password,” click OK, then enter the password.\n3. Set the power plan to never sleep (Settings → System → Power).";
  dialog.showMessageBox({
    type: "info",
    title: "Set Up an Unattended Host",
    message: "Keep this computer serving Otto even when no one is signed in.",
    detail:
      "For a back-office computer that nobody uses directly:\n\n" +
      steps +
      "\n\nWith those set, this computer starts Otto automatically and keeps workstations connected without anyone logging in.",
    buttons: ["OK"],
  });
}

// --- Update menu handlers ---

async function _checkForUpdates() {
  const { dialog } = await import("electron");

  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: "info",
      title: "Check for Updates",
      message: "Updates are disabled in development mode.",
      buttons: ["OK"],
    });
    return;
  }

  // Show a "checking" dialog
  const result = await checkForUpdatesManual();

  if (result.status === "ready") {
    await _performUpdateInstall();
  } else if (result.status === "downloading") {
    dialog.showMessageBox({
      type: "info",
      title: "Update Downloading",
      message: `Version ${result.version} is downloading.`,
      detail: "You'll be notified when it's ready to install.",
      buttons: ["OK"],
    });
  } else if (result.status === "up-to-date") {
    dialog.showMessageBox({
      type: "info",
      title: "No Updates Available",
      message: `You're on the latest version (v${app.getVersion()}).`,
      buttons: ["OK"],
    });
  } else if (result.status === "error") {
    dialog.showMessageBox({
      type: "warning",
      title: "Update Check Failed",
      message: "Could not check for updates.",
      detail: result.error || "Please check your internet connection and try again.",
      buttons: ["OK"],
    });
  } else {
    // Fallback for unexpected states — show diagnostic info
    dialog.showMessageBox({
      type: "info",
      title: "Check for Updates",
      message: `Current version: v${app.getVersion()}`,
      detail: `Status: ${result.status}\nVersion: ${result.version || "none"}\nError: ${result.error || "none"}`,
      buttons: ["OK"],
    });
  }
}

async function _installUpdate() {
  const state = getUpdateState();

  if (state.status !== "ready") {
    dialog.showMessageBox({
      type: "info",
      title: "No Update Ready",
      message: "No update is downloaded yet. Use \"Check for Updates\" first.",
      buttons: ["OK"],
    });
    return;
  }

  await _performUpdateInstall();
}

// Single chokepoint for installing a downloaded update. Confirms (unless
// silent), then runs the SAME graceful teardown the normal quit does — a final
// backup + server shutdown — BEFORE handing off to electron-updater's
// quitAndInstall. Doing the teardown here (rather than in before-quit) lets the
// update's quit proceed normally so the installer runs and the app relaunches;
// the always-on Host's before-quit path would otherwise app.exit(0) and skip
// the install entirely.
async function _performUpdateInstall(options = {}) {
  if (updateInstallInProgress) return;
  if (getUpdateState().status !== "ready") return;

  const silent = options?.silent === true;
  if (!silent) {
    let clientCount = 0;
    try {
      const getCount = globalThis.__ottoGetConnectedClientCount;
      if (typeof getCount === "function") clientCount = getCount();
    } catch {
      clientCount = 0;
    }
    const { response } = await dialog.showMessageBox(
      buildUpdateInstallPrompt(clientCount, getUpdateState().version),
    );
    if (response !== 0) return; // "Later" — keep the cached download for next time
  }

  // Commit. These flags make the window close-interceptor and before-quit step
  // aside, so quitAndInstall's quit + relaunch isn't turned into a hide-to-tray
  // or a hard app.exit(0).
  updateInstallInProgress = true;
  app.__ottoQuitting = true;
  stopAutoUpdater();

  // Land a final backup and free the port/connections (both no-op for a
  // Client), then let electron-updater drive the quit, install, and relaunch.
  try {
    await _runShutdownBackup();
  } catch (error) {
    console.error("Pre-update backup failed:", error?.message || error);
    try { Sentry.captureException(error); } catch { /* sentry not configured */ }
  }
  _runShutdown();

  installUpdateRaw();
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

    // Rebuild the order-sheet-attachments folder from the sidecar that
    // sits next to the .sqlite (otto-backup-<ts>-attachments/). Legacy
    // backups without a sidecar restore cleanly too — the dir is just
    // empty and job dialogs fall back to "no preview saved".
    try {
      const restoredCount = restoreAttachmentsFromBackup(restoreFrom, path.dirname(sqlitePath));
      _logStartup(`Restore: re-populated ${restoredCount} attachment(s) from sidecar`);
    } catch (attachErr) {
      console.error("Restore: failed to restore attachments sidecar", attachErr);
    }

    // Stamp `onboarding.source = 'backup'` on every office in the restored DB
    // so that the BackupRestoreBanner shows after the user logs in. Without
    // this, a backup taken while `source=fresh` would carry that value through,
    // and the user would never see the "restored from backup" indicator.
    try {
      const Database = require("better-sqlite3");
      const db = new Database(sqlitePath);
      try {
        const rows = db.prepare("SELECT id, settings FROM offices").all();
        const updateStmt = db.prepare("UPDATE offices SET settings = ? WHERE id = ?");
        for (const row of rows) {
          let parsed = {};
          try {
            parsed = typeof row.settings === "string" ? JSON.parse(row.settings || "{}") : (row.settings || {});
          } catch {
            parsed = {};
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
          const now = new Date().toISOString();
          parsed.onboarding = {
            state: "completed",
            source: "backup",
            completedSteps: [
              "welcome", "identifier_mode", "statuses", "job_types",
              "destinations", "custom_columns", "notification_rules", "ehr_import", "done",
            ],
            skippedAt: null,
            completedAt: now,
            startedAt: now,
            version: 1,
          };
          updateStmt.run(JSON.stringify(parsed), row.id);
        }
      } finally {
        db.close();
      }
    } catch (stampErr) {
      console.error("Restore: failed to stamp onboarding.source=backup", stampErr);
    }
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
  process.env.OTTO_APP_VERSION = app.getVersion();

  const repoRoot = path.resolve(__dirname, "..");
  const serverEntry = path.join(repoRoot, "dist", "index.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server build not found at ${serverEntry}. Run \`npm run build\` first.`);
  }

  _logStartup(`Starting host server from: ${serverEntry}`);

  hostServerStarted = true;
  void import(pathToFileURL(serverEntry).href).then(() => {
    _logStartup("Host server module loaded successfully");
  }).catch(async (error) => {
    hostServerStarted = false;
    _logStartup("Host server failed to start", error?.stack || error?.message || error);
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
      // This is a localhost-only health probe to our own server.
      // Use rejectUnauthorized: false because:
      //   1. We're connecting to 127.0.0.1 — no MITM risk on loopback
      //   2. Existing certs may not have SAN entries for 127.0.0.1
      //   3. The F-16 fix (explicit CA) applies to cross-machine IPC, not
      //      the internal readiness check
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

/**
 * If port 5150 is held by a stale Otto process (e.g. crashed without running
 * before-quit), find and kill it.  This prevents the "Server did not start in
 * time" error that happens when the previous instance didn't release the port.
 *
 * Only kills processes named "Otto Tracker" or "otto-tracker" — never a
 * random unrelated process.
 */
async function killStalePortHolder(port) {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  try {
    let pid = null;

    if (process.platform === "darwin" || process.platform === "linux") {
      // lsof -i :5150 -t returns PIDs listening on the port
      const { stdout } = await execFileAsync("lsof", ["-i", `:${port}`, "-t"], { timeout: 5000 }).catch(() => ({ stdout: "" }));
      const pids = stdout.trim().split(/\n/).filter(Boolean).map(Number).filter(n => n > 0 && n !== process.pid);
      if (pids.length === 0) return false;
      pid = pids[0];

      // Verify it's actually Otto before killing
      const { stdout: psOut } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], { timeout: 5000 }).catch(() => ({ stdout: "" }));
      const comm = psOut.trim().toLowerCase();
      if (!comm.includes("otto") && !comm.includes("electron")) {
        console.log(`[port-cleanup] Port ${port} held by non-Otto process (${comm}, PID ${pid}) — not killing.`);
        return false;
      }
    } else if (process.platform === "win32") {
      // netstat to find PID, then tasklist to verify it's Otto
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { timeout: 5000 }).catch(() => ({ stdout: "" }));
      const line = stdout.split(/\r?\n/).find(l => l.includes(`:${port}`) && l.includes("LISTENING"));
      if (!line) return false;
      const parts = line.trim().split(/\s+/);
      pid = Number(parts[parts.length - 1]);
      if (!pid || pid === process.pid) return false;

      const { stdout: taskOut } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 5000 }).catch(() => ({ stdout: "" }));
      const taskName = taskOut.toLowerCase();
      if (!taskName.includes("otto") && !taskName.includes("electron")) {
        console.log(`[port-cleanup] Port ${port} held by non-Otto process (PID ${pid}) — not killing.`);
        return false;
      }
    }

    if (!pid) return false;

    console.log(`[port-cleanup] Killing stale Otto process (PID ${pid}) holding port ${port}.`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // SIGTERM might not work on Windows, try SIGKILL
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }

    // Wait a moment for the port to be freed
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch (err) {
    console.warn(`[port-cleanup] Could not check port ${port}:`, err?.message);
    return false;
  }
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

  // Decide ONCE — before maybeStartHostServer flips hostServerStarted — whether
  // this launch must bring the host server up. On a reopen (the window was
  // destroyed but the always-on server kept running) this is false, so we skip
  // the port pre-flight that would otherwise collide with our own server and
  // show a spurious "port in use" error. See shouldStartHostServer.
  const needHostBringUp = shouldStartHostServer(config, hostServerStarted);

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

    if (needHostBringUp) {
      const port = Number(process.env.PORT || "5150");
      let available = await isPortAvailable(port, "0.0.0.0");
      if (!available) {
        // Try to kill a stale Otto process holding the port (e.g. crashed without before-quit)
        const killed = await killStalePortHolder(port);
        if (killed) {
          available = await isPortAvailable(port, "0.0.0.0");
        }
      }
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

    if (needHostBringUp) {
      await maybeStartHostServer();
    }

    if (needHostBringUp) {
      const protocol = app.isPackaged ? "https" : "http";
      const port = process.env.PORT || "5150";
      let readiness = await waitForHostReady({
        protocol,
        host: "127.0.0.1",
        port,
        timeoutMs: 30000,
      });

      while (!readiness.ok) {
        _logStartup(`waitForHostReady failed: ${readiness.error?.message || readiness.error || "unknown"}`);
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

    // Order-sheet folder watcher runs in both modes — sheets get saved on
    // whichever computer sits at the front desk. Failures are non-fatal:
    // a missing folder surfaces as a status banner in the UI, not a
    // launch blocker.
    syncOrderSheetWatcherFromConfig().catch((error) => {
      _logStartup("[order-sheets] failed to start watcher", error);
    });

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

// --- Order-sheet folder automation (desktop side) ---
//
// The watcher lives in the main process (only it can read the disk); the
// renderer owns all server communication so ingestion happens under the
// signed-in user's session. Settings live in otto-config.json under
// `orderSheets` and are managed through their own IPC handler — NOT
// otto:config:set, which relaunches the whole app for non-setup changes.

function sendOrderSheetsEvent(payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("otto:orderSheets:event", payload);
    }
  } catch {
    // window mid-teardown — ignore
  }
}

function getOrderSheetsConfig(config) {
  const section = config && typeof config.orderSheets === "object" && config.orderSheets ? config.orderSheets : {};
  return {
    enabled: !!section.enabled,
    folder: typeof section.folder === "string" ? section.folder : "",
    includeExisting: !!section.includeExisting,
    enabledAt: Number(section.enabledAt) || 0,
    // Auto-print defaults ON: turning on folder-watching is opting into the
    // "save the sheet and Otto prints it" flow. Stored as `autoPrint`;
    // absent → true so existing watchers get the new behavior on upgrade.
    autoPrint: section.autoPrint !== false,
  };
}

function ensureOrderSheetWatcher() {
  if (!orderSheetWatcher) {
    orderSheetWatcher = createOrderSheetWatcher({
      onPending: (pending) => sendOrderSheetsEvent({ kind: "pending", pending }),
      onStatus: (status) => sendOrderSheetsEvent({ kind: "status", status }),
      log: (message, error) => _logStartup(message, error),
    });
  }
  return orderSheetWatcher;
}

async function syncOrderSheetWatcherFromConfig() {
  const settings = getOrderSheetsConfig(_readConfig());
  const watcher = ensureOrderSheetWatcher();
  if (settings.enabled && settings.folder) {
    await watcher.start({
      folder: settings.folder,
      includeExisting: settings.includeExisting,
      enabledAt: settings.enabledAt,
    });
  } else {
    await watcher.stop();
  }
}

ipcMain.handle("otto:orderSheets:get", async () => {
  const watcher = ensureOrderSheetWatcher();
  return {
    config: getOrderSheetsConfig(_readConfig()),
    status: watcher.getStatus(),
    pending: watcher.getPending(),
  };
});

ipcMain.handle("otto:orderSheets:pick-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose the folder where order sheets are saved",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false };
  return { ok: true, folder: result.filePaths[0] };
});

ipcMain.handle("otto:orderSheets:configure", async (_event, payload) => {
  const config = _readConfig();
  const previous = getOrderSheetsConfig(config);
  const next = {
    enabled: typeof payload?.enabled === "boolean" ? payload.enabled : previous.enabled,
    folder: typeof payload?.folder === "string" ? payload.folder.trim() : previous.folder,
    includeExisting:
      typeof payload?.includeExisting === "boolean" ? payload.includeExisting : previous.includeExisting,
    enabledAt: previous.enabledAt,
    autoPrint: typeof payload?.autoPrint === "boolean" ? payload.autoPrint : previous.autoPrint,
  };

  // Stamp the moment the automation turns on (or moves to a new folder) —
  // that's the cutoff for "new files only".
  const turningOn = next.enabled && (!previous.enabled || previous.folder !== next.folder);
  if (turningOn) next.enabledAt = Date.now();
  if (!next.enabled) next.includeExisting = false;

  _writeConfig({ ...config, orderSheets: next });
  await syncOrderSheetWatcherFromConfig();

  const watcher = ensureOrderSheetWatcher();
  return { ok: true, config: next, status: watcher.getStatus(), pending: watcher.getPending() };
});

ipcMain.handle("otto:orderSheets:extract", async (_event, payload) => {
  const requestedPath = typeof payload?.path === "string" ? payload.path : "";
  const watcher = ensureOrderSheetWatcher();
  // Only files the watcher itself discovered may be read — the renderer
  // never gets generic filesystem access through this channel.
  const entry = watcher.getPending().find((candidate) => candidate.path === requestedPath);
  if (!entry) return { extractError: "File is no longer pending." };
  try {
    return await watcher.extract(requestedPath);
  } catch (error) {
    return { extractError: `Couldn't read the file (${error?.message || "unknown error"}).` };
  }
});

// Hand the renderer the raw bytes of a pending file so it can render
// page 1 to a JPEG via pdf.js + canvas (which only exist on the renderer
// side). Same guard as extract: the path must be one the watcher itself
// discovered, so this channel never doubles as generic filesystem read.
// Capped at 25MB (same as MAX_ORDER_SHEET_BYTES in the watcher).
ipcMain.handle("otto:orderSheets:read-bytes", async (_event, payload) => {
  const requestedPath = typeof payload?.path === "string" ? payload.path : "";
  const watcher = ensureOrderSheetWatcher();
  const entry = watcher.getPending().find((candidate) => candidate.path === requestedPath);
  if (!entry) return { error: "File is no longer pending." };
  try {
    const fs = await import("fs/promises");
    const buffer = await fs.readFile(requestedPath);
    if (buffer.byteLength > 25 * 1024 * 1024) {
      return { error: "File too large for preview." };
    }
    // Uint8Array marshals cleanly over IPC and the renderer handles it
    // as a plain typed-array.
    return { bytes: new Uint8Array(buffer) };
  } catch (error) {
    return { error: `Couldn't read the file (${error?.message || "unknown error"}).` };
  }
});

ipcMain.handle("otto:orderSheets:ack", async (_event, payload) => {
  const hash = typeof payload?.hash === "string" ? payload.hash : "";
  if (hash) ensureOrderSheetWatcher().ack(hash);
  return { ok: true };
});

// Open a saved order sheet in the OS's own viewer (Preview, Acrobat, …).
// The renderer already holds the bytes (fetched under its session); we
// land them in a per-app temp folder and hand off to the OS. The temp
// copy is PHI, so the folder is wiped on every app start and files are
// owner-only.
const orderSheetTempDir = () => path.join(app.getPath("temp"), "otto-order-sheets");

function cleanOrderSheetTempDir() {
  try {
    fs.rmSync(orderSheetTempDir(), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

ipcMain.handle("otto:orderSheets:open-external", async (_event, payload) => {
  try {
    const bytes = payload?.bytes;
    const isBinary = bytes instanceof Uint8Array || Buffer.isBuffer(bytes);
    if (!isBinary || bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
      return { error: "Invalid file payload." };
    }
    const rawName = typeof payload?.fileName === "string" ? payload.fileName : "order-sheet.pdf";
    const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "order-sheet.pdf";
    const dir = orderSheetTempDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, Buffer.from(bytes), { mode: 0o600 });
    const openError = await shell.openPath(filePath);
    if (openError) return { error: openError };
    return { ok: true };
  } catch (error) {
    return { error: `Couldn't open the file (${error?.message || "unknown error"}).` };
  }
});

// Auto-print: surface an imported order sheet for printing. This is the
// "save the sheet, Otto prints it" flow — it replaces walking the printed
// EHR sheet to the tray. Per the office's choice it shows the print
// dialog each time (no silent printing): on Windows we invoke the default
// PDF handler's "print" verb (Edge/Acrobat opens its print dialog); on
// macOS we drive Preview via AppleScript so the system print dialog
// appears automatically — `shell.openPath` alone just opens the file and
// forces the user to press Cmd-P, which doesn't match what the auto-print
// setting promises. webContents.print() is deliberately avoided — it
// renders PDFs blank on our Electron (29) and we don't bump versions.
//
// Security: only files that live INSIDE the configured watch folder and
// carry a supported extension may be printed, so this channel can't be
// turned into arbitrary "open any path" by the renderer.
const ORDER_SHEET_PRINTABLE_EXT = /\.(pdf|txt|text)$/i;

ipcMain.handle("otto:orderSheets:print", async (_event, payload) => {
  const requestedPath = typeof payload?.path === "string" ? payload.path : "";
  if (!requestedPath) return { error: "No file path." };
  const cfg = getOrderSheetsConfig(_readConfig());
  if (!cfg.folder) return { error: "No watch folder configured." };

  // Resolve symlinks on BOTH the requested file and the folder before the
  // containment check — path.resolve only normalizes `..`/`.`, so a symlink
  // inside the folder pointing elsewhere would otherwise pass and let the
  // renderer print an arbitrary file. realpathSync also throws if the file
  // is gone, covering the existence check.
  let realResolved;
  let realFolder;
  try {
    realFolder = fs.realpathSync(path.resolve(cfg.folder));
    realResolved = fs.realpathSync(path.resolve(requestedPath));
  } catch {
    return { error: "File no longer exists." };
  }
  const inFolder = realResolved === realFolder || realResolved.startsWith(realFolder + path.sep);
  if (!inFolder || !ORDER_SHEET_PRINTABLE_EXT.test(realResolved)) {
    return { error: "File is outside the watched folder." };
  }

  // Copy to a GENERIC-named temp file before printing. Order-sheet
  // filenames routinely carry PHI ("JaneDoe_DOB_OrderSheet.pdf"), and both
  // the Windows print dialog and macOS Preview show the filename to anyone
  // standing at the printer. The temp copy lives in the same wiped-on-launch
  // 0600 dir as open-external, named with a non-PHI stamp.
  let printPath;
  try {
    const dir = orderSheetTempDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ext = path.extname(realResolved).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".pdf";
    printPath = path.join(dir, `order-sheet-${Date.now().toString(36)}${ext}`);
    fs.copyFileSync(realResolved, printPath);
    fs.chmodSync(printPath, 0o600);
  } catch (error) {
    _logStartup(`[order-sheets] print: temp copy failed: ${error?.message || error}`);
    return { error: "Couldn't prepare the file for printing." };
  }

  try {
    if (process.platform === "win32") {
      // Route to the default PDF handler's Print action (shows its dialog).
      // The path is passed as an ENV VAR, never interpolated into the
      // -Command string: Windows filenames may legally contain `$( )` and
      // backticks, which PowerShell would otherwise execute. As an env var
      // it's plain data that `-FilePath` consumes verbatim (also avoids the
      // backslash-doubling a quoted/JSON path would suffer). Falls back to
      // just opening the file if the association has no print verb.
      const { spawn } = await import("child_process");
      const ok = await new Promise((resolve) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "Start-Process -FilePath $env:OTTO_PRINT_PATH -Verb Print",
          ],
          { windowsHide: true, env: { ...process.env, OTTO_PRINT_PATH: printPath } },
        );
        child.on("error", (err) => {
          _logStartup(`[order-sheets] print: powershell spawn error: ${err?.message || err}`);
          resolve(false);
        });
        child.on("exit", (code) => resolve(code === 0));
      });
      if (!ok) {
        _logStartup("[order-sheets] print: print verb unavailable; opening the sheet instead");
        const openError = await shell.openPath(printPath);
        if (openError) {
          _logStartup(`[order-sheets] print: openPath fallback failed: ${openError}`);
          return { error: openError };
        }
      }
      return { ok: true };
    }
    if (process.platform === "darwin") {
      // Drive Preview to AUTOMATICALLY show the system print dialog instead
      // of just opening the doc and waiting for the user to press Cmd-P.
      // The file path is passed as argv[1] (not interpolated) so osascript
      // treats it as data — filenames with quotes / backticks can't break
      // out of the script. `with properties {} print dialog true` is the
      // standard scripting verb that forces the print sheet to appear on
      // the front document.
      const { spawn } = await import("child_process");
      const script = `on run argv
  set theFile to POSIX file (item 1 of argv)
  tell application "Preview"
    activate
    open theFile
  end tell
  delay 0.4
  tell application "Preview"
    print front document with properties {} print dialog true
  end tell
end run`;
      const ok = await new Promise((resolve) => {
        const child = spawn("osascript", ["-e", script, printPath]);
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", (err) => {
          _logStartup(`[order-sheets] print: osascript spawn error: ${err?.message || err}`);
          resolve(false);
        });
        child.on("exit", (code) => {
          if (code !== 0) {
            _logStartup(`[order-sheets] print: osascript exit ${code}: ${stderr.trim()}`);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
      if (!ok) {
        // Preview missing / scripting blocked: fall back to just opening the
        // file so staff can still Cmd-P manually rather than losing the
        // sheet entirely.
        _logStartup("[order-sheets] print: osascript failed; opening the sheet instead");
        const openError = await shell.openPath(printPath);
        if (openError) {
          _logStartup(`[order-sheets] print: openPath fallback failed: ${openError}`);
          return { error: openError };
        }
      }
      return { ok: true };
    }
    // Linux / other: open in the default viewer; the user prints from there.
    const openError = await shell.openPath(printPath);
    if (openError) {
      _logStartup(`[order-sheets] print: openPath failed: ${openError}`);
      return { error: openError };
    }
    return { ok: true };
  } catch (error) {
    _logStartup(`[order-sheets] print failed: ${error?.message || error}`);
    return { error: `Couldn't print the file (${error?.message || "unknown error"}).` };
  }
});

// --- IPC Handlers ---

ipcMain.handle("otto:config:get", async () => _readConfig());
ipcMain.handle("otto:config:set", async (_event, configInput) => {
  const hadConfigFileBeforeWrite = fs.existsSync(_getConfigPath());
  const previous = _readConfig();
  const config = { ...getDefaultConfig(), ...previous, ...configInput };

  // A first-time setup save is partial (host server not bootstrapped yet) — mark
  // it incomplete so an abandoned setup re-opens to the setup window. Stays true
  // once setup has finished (carried through via ...previous on later saves).
  if (config.setupComplete !== true) config.setupComplete = false;

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
        let portFree = await isPortAvailable(numPort, "0.0.0.0");
        if (!portFree) {
          const killed = await killStalePortHolder(numPort);
          if (killed) portFree = await isPortAvailable(numPort, "0.0.0.0");
        }
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
          _logStartup(`waitForHostReady failed: ${readiness.error?.message || readiness.error || "unknown"}`);
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
    // Client setup finishes here: it connects to an existing host (no bootstrap
    // step), and not every client path calls otto:setup:complete. Stamp it so a
    // reopen lands on the app, not back in setup.
    _writeConfig({ ...config, setupComplete: true });
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

ipcMain.handle("otto:import:pick-csv", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select CSV file to import",
    properties: ["openFile"],
    filters: [{ name: "CSV Files", extensions: ["csv", "txt"] }],
    defaultPath: app.getPath("documents"),
  });

  if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, filePath: filePaths[0] };
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

ipcMain.handle("otto:setup:complete", async (_event, payload) => {
  const config = _readConfig();
  // This fires only after setup truly finishes (host bootstrap / client
  // register succeeded). Stamp completion so a reopen skips setup.
  if (config.setupComplete !== true) {
    config.setupComplete = true;
    _writeConfig(config);
  }
  _setAppMenu(config);

  // Auto-login support: if setup passes credentials, append them as a hash
  // fragment so the auth page can auto-submit on first load.
  // Hash fragments are never sent to the server (safe from logging).
  let targetUrl = _getTargetUrlForConfig(config);
  const loginId = payload?.autoLoginId;
  const pin = payload?.autoLoginPin;
  if (loginId && pin) {
    const params = new URLSearchParams({ loginId, pin });
    targetUrl += `/auth#autoLogin=${params.toString()}`;
  }

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

// Open an external URL in the user's default browser.
// Only allows https:// URLs whose origin matches the configured portal origin —
// prevents arbitrary URL opens from compromised renderer content.
ipcMain.handle("otto:external:open", async (_event, rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl) {
    return { ok: false, message: "No URL provided." };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, message: "Invalid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Only https URLs are allowed." };
  }
  const portalBase = getPortalBaseUrl();
  if (parsed.origin !== portalBase.origin) {
    return { ok: false, message: "URL is not in the allowed portal origin." };
  }
  try {
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
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

/**
 * Client-side wipe for "Uninstall and remove from account".
 *
 * Called AFTER the Client has already POSTed /api/devices/self/release
 * to the Host (which frees the seat). This handler removes everything
 * that ties THIS computer to the office: config file (mode, hostUrl,
 * pairing code, trusted cert fingerprint), browser session storage
 * (cookies, localStorage including the deviceId, IndexedDB), and the
 * TLS / outbox / session-secret blobs under userData.
 *
 * Doesn't try to delete the Otto.app binary itself — Electron can't
 * remove its own /Applications entry while running. The Client UI
 * shows OS-specific "drag to Trash" instructions, then this handler
 * quits the app. On next launch (if any), Otto goes through setup
 * fresh.
 */
/**
 * Persist a recovery token the Client just received over WS from
 * its Host. The token never lives in the renderer's localStorage —
 * the main process holds it in the Electron config so renderer XSS
 * can't lift it. Idempotent: a Client that already has a token gets
 * the new one (Host re-issuance is rare but harmless).
 */
ipcMain.handle("otto:client:recovery:store", async (_event, payload) => {
  try {
    const cfg = _readConfig();
    if (!cfg || cfg.mode !== "client") {
      return { ok: false, error: "Only Clients can store a recovery token." };
    }
    const token = typeof payload?.recoveryToken === "string" ? payload.recoveryToken : "";
    if (!token || token.length > 256) {
      return { ok: false, error: "Invalid recovery token." };
    }
    const next = { ...cfg, clientRecoveryToken: token };
    _writeConfig(next);
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

/**
 * Ask the portal for the office's CURRENT Host discovery info using
 * this Client's stored recovery token. The renderer calls this when
 * its WebSocket reconnects keep failing — usually because the Host
 * has been replaced and the stored hostUrl/fingerprint are stale.
 *
 * Returns the discovery payload (hostUrl, fingerprint256,
 * hostReplacementPending, updatedAt) and a `changed` boolean
 * indicating whether the portal's view differs from what this
 * Client is currently configured with. The renderer uses that to
 * decide whether to show the "Reconnect to new Host?" banner.
 *
 * The recovery token never crosses the IPC boundary — only its
 * effects do.
 */
ipcMain.handle("otto:client:recovery:lookup", async (_event) => {
  try {
    const cfg = _readConfig();
    if (!cfg || cfg.mode !== "client") {
      return { ok: false, error: "Only Clients have a recovery token." };
    }
    const token = cfg.clientRecoveryToken;
    if (!token) {
      return { ok: false, error: "No recovery token on this Client. Re-pair via setup if your Host changed." };
    }

    const base = getPortalBaseUrl();
    const url = new URL("/license/v1/client-recovery/lookup", base);
    const body = JSON.stringify({ recoveryToken: token });
    const result = await new Promise((resolve, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, json: null }); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Portal lookup timed out.")); });
      req.write(body);
      req.end();
    });

    if (result.status === 410) {
      // Office revoked this token. The Client has been kicked off
      // the account; renderer should show "contact your office".
      return { ok: false, code: "REVOKED", error: "This Client was removed from the office. Contact your office to re-pair." };
    }
    if (result.status < 200 || result.status >= 300) {
      return { ok: false, error: result.json?.error || `Portal returned ${result.status}.` };
    }

    const portalHostUrl = typeof result.json?.hostUrl === "string" ? result.json.hostUrl : null;
    const portalFingerprint = typeof result.json?.fingerprint256 === "string" ? result.json.fingerprint256 : null;
    const portalPairingCode = typeof result.json?.pairingCode === "string" ? result.json.pairingCode : null;
    const changed = (
      (portalHostUrl && portalHostUrl !== cfg.hostUrl) ||
      (portalFingerprint && portalFingerprint !== cfg.trustedFingerprint256)
    );
    return {
      ok: true,
      changed: !!changed,
      hostUrl: portalHostUrl,
      fingerprint256: portalFingerprint,
      pairingCode: portalPairingCode,
      hostReplacementPending: !!result.json?.hostReplacementPending,
      updatedAt: typeof result.json?.updatedAt === "string" ? result.json.updatedAt : null,
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

/**
 * Apply a discovered Host change: update the Client's config to point
 * at the new hostUrl, trust the new fingerprint, and reload the
 * BrowserWindow so the session reconnects fresh against the new
 * server. Only runnable in Client mode. The renderer calls this
 * after the user confirms the "Reconnect to new Host?" banner — the
 * one-tap path requested by spec.
 */
ipcMain.handle("otto:client:recovery:apply", async (_event, payload) => {
  try {
    const cfg = _readConfig();
    if (!cfg || cfg.mode !== "client") {
      return { ok: false, error: "Only Clients can apply a recovery." };
    }
    const newHostUrl = typeof payload?.hostUrl === "string" ? payload.hostUrl.trim() : "";
    const newFingerprint = typeof payload?.fingerprint256 === "string" ? payload.fingerprint256.trim() : "";
    if (!newHostUrl || !newFingerprint) {
      return { ok: false, error: "Missing new host URL or fingerprint." };
    }

    try { new URL(newHostUrl); }
    catch { return { ok: false, error: "Portal returned an invalid host URL." }; }

    const next = {
      ...cfg,
      hostUrl: newHostUrl,
      trustedFingerprint256: newFingerprint,
    };
    _writeConfig(next);

    // Reload the BrowserWindow so the renderer reconnects to the new
    // origin. We don't restart the whole Electron process — the
    // config write + reload is enough, and avoids a jarring full
    // relaunch flicker.
    try {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.reload();
    } catch { /* ignore */ }

    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle("otto:client:release", async (_event) => {
  try {
    const cfg = _readConfig();
    // Fail CLOSED on anything that isn't a confirmed Client install:
    //   - missing config (could be a half-set-up Host)
    //   - mode field missing (older versions before mode was tracked)
    //   - mode === "host" (the very thing we're protecting against)
    // Wiping a live Host's userData would destroy the office's
    // SQLite + certs irrecoverably. Host removal must go through the
    // portal's Replace Host flow, which deactivates the host token
    // server-side and issues a single-use claim code to the
    // replacement computer.
    if (!cfg || cfg.mode !== "client") {
      return { ok: false, error: "Host removal must go through the portal — use Replace Host." };
    }

    // Belt-and-braces: if the local SQLite file exists and has data,
    // this machine has hosted office data at some point. Refuse to
    // wipe even if mode somehow flipped to "client" by mistake.
    try {
      const sqlitePath = _getSqlitePath();
      if (fs.existsSync(sqlitePath)) {
        const stat = fs.statSync(sqlitePath);
        // 64 KB threshold — SQLite header alone is well under this;
        // a real office with even a handful of jobs is far larger.
        if (stat.size > 64 * 1024) {
          return { ok: false, error: "This computer holds office data. Use the portal's Replace Host flow instead — uninstalling here would destroy that data." };
        }
      }
    } catch { /* if we can't stat it, fall through — the mode check above is the primary gate */ }

    // 1. Wipe browser session state for the BrowserWindow so the
    //    deviceId, auth cookies, and any cached data are gone before
    //    the app quits.
    try {
      const win = BrowserWindow.getAllWindows()[0];
      const ses = win?.webContents?.session;
      if (ses) {
        await ses.clearStorageData({
          storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers", "cachestorage", "shadercache"],
        });
        await ses.clearCache();
      }
    } catch { /* non-critical */ }

    // 2. Wipe local files: config (mode, hostUrl, pairing code,
    //    cert fingerprint), TLS dir, outbox, session-secret. Keep
    //    the userData folder itself so logs can still be flushed
    //    before exit; everything inside it is fair game.
    try {
      const userData = app.getPath("userData");
      const entries = fs.readdirSync(userData);
      for (const name of entries) {
        // Leave the auto-updater's pending cache alone — if there's
        // a downloaded update mid-install, deleting it would leave
        // the user with a half-installed binary on next launch.
        if (name === "pending") continue;
        const p = path.join(userData, name);
        try {
          const stat = fs.lstatSync(p);
          if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
          else fs.unlinkSync(p);
        } catch { /* skip locked files; the rest of the wipe still proceeds */ }
      }
    } catch { /* non-critical */ }

    // 3. Quit after a short delay so the renderer has time to show
    //    its "Otto removed — drag to Trash" final screen before the
    //    window vanishes.
    setTimeout(() => {
      try { app.quit(); } catch { /* ignore */ }
    }, 1200);

    return { ok: true, platform: process.platform };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }
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

ipcMain.handle("otto:portal:client-register", async (_event, payload) => {
  const { hostUrl, firstName, lastName, loginId, pin } = payload || {};
  if (!hostUrl) return { ok: false, error: "Missing host URL." };

  try {
    const registerUrl = new URL("/api/setup/client-register", hostUrl);
    const body = JSON.stringify({ firstName, lastName, loginId, pin });
    const mod = registerUrl.protocol === "https:" ? https : http;

    const result = await new Promise((resolve, reject) => {
      // rejectUnauthorized: false is intentional here — this connects to a
      // user-provided hostUrl over the LAN, and cert validation is handled by
      // Electron's setCertificateVerifyProc with fingerprint pinning (F-16).
      const req = mod.request(registerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
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
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out.")); });
      req.write(body);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      const error = result.json?.error || `Registration failed (${result.status})`;
      return { ok: false, error, message: result.json?.message || null, status: result.status };
    }

    return { ok: true, data: result.json };
  } catch (err) {
    _logStartup("client-register IPC error", err?.message, err?.stack);
    return { ok: false, error: err?.message || "Could not reach the Host computer." };
  }
});

ipcMain.handle("otto:reconnect:now", (event) => {
  // "Try now" on the offline page. An in-window loadURL can't recover a wedged
  // client connection, so probe the host immediately instead; if it answers,
  // the watch relaunches the client.
  try {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w && !w.isDestroyed()) _startClientReconnectWatch(w, true);
  } catch (error) {
    _logStartup("reconnect:now failed", error);
  }
  return { ok: true };
});

// --- App lifecycle ---

app.whenReady().then(async () => {
  loadDevDotEnv(app);
  migrateLegacyUserDataDir(app);
  applyOfflineDefaultsRaw(app);
  ensureSessionSecret(app);
  // Tell the embedded Express server to write to the same startup.log file
  // that the main process uses.  Without this, server progress/errors go to
  // OTTO_DATA_DIR/startup.log (the data/ subdirectory) while the main process
  // writes to userData/startup.log — making server errors invisible.
  process.env.OTTO_STARTUP_LOG_PATH = getStartupLogPath(app);
  maybeRestoreDatabaseFromArgs();
  // Temp copies of order sheets (handed to the OS viewer) are PHI —
  // never let them outlive the session that created them.
  cleanOrderSheetTempDir();
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

  // Re-initialize Sentry with DSN from .env (now loaded) if it wasn't set at
  // import time.  This is a no-op if SENTRY_DSN was already present.
  initSentryMain({ appVersion: app.getVersion() });

  if (!_isSetupComplete()) {
    _setAppMenu(getDefaultConfig());
    _createSetupWindow();
    return;
  }

  const config = _readConfig();
  setSentryAppMode(config.mode || "unknown");
  await launchMainWindowForConfig(config, { showBootWindow: true });

  // Always-on host (Workstream A): keep the office machine coming back up as the
  // Host after a reboot, and put a tray icon up so closing the window hides
  // instead of taking the office offline. Both are inert unless the
  // OTTO_ALWAYS_ON_HOST capability is enabled and this machine is a Host.
  _reconcileLoginItem(config);
  if (isResidentApp(config)) {
    createTray();
  }

  // Start silent auto-update checks (no-ops in dev / unpackaged mode).
  initAutoUpdater();

  // Track whether a launch-time auto-install is handling the update
  // to prevent the background notification from showing a duplicate dialog.
  let launchInstallHandled = false;

  // Rebuild menu when update state changes (e.g. "ready" enables the install button).
  // Also show a notification dialog when a background download finishes.
  onUpdateStateChange((state) => {
    try {
      const currentConfig = _readConfig();
      _setAppMenu(currentConfig);
    } catch {
      // ignore — config may not exist during setup
    }

    // Notify user when a background download completes — but NOT if the
    // launch-time auto-install already handled this update. _performUpdateInstall
    // shows the confirm (with a connected-workstations warning when relevant).
    if (state.status === "ready" && state.version && !launchInstallHandled) {
      void _performUpdateInstall();
    }
  });

  // Auto-install on launch: if a previously-downloaded update is cached,
  // electron-updater detects it immediately and fires "update-downloaded".
  // Install directly without requiring user action.
  onUpdateReadyAtLaunch(async (version) => {
    launchInstallHandled = true;
    console.log(`[auto-updater] Update v${version} ready at launch — auto-installing.`);
    // Small delay for the app window to settle, then install silently (no
    // prompt at launch; this runs the graceful teardown before relaunching).
    setTimeout(() => {
      void _performUpdateInstall({ silent: true });
    }, 2000);
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // Always-on host: keep the embedded server alive (and the office online) even
  // when every window is gone. In production (capability off) this is false and
  // the app quits on last-window-close exactly as before.
  try {
    if (!app.__ottoQuitting && isResidentApp(_readConfig())) return;
  } catch {
    // fall through to the default quit
  }
  app.quit();
});

/**
 * Cleanup server, connections, and session data before exit.
 * Called from the before-quit handler (both normal path and "Close Anyway").
 */
function _runShutdown() {
  // Stop the order-sheet watcher first so chokidar's fs handles don't
  // keep the process alive.
  try {
    if (orderSheetWatcher) void orderSheetWatcher.stop();
  } catch {
    // best-effort
  }

  // Force-close the Express server and all open connections so port 5150
  // is freed immediately.  Without this, keep-alive/WebSocket connections
  // linger in TIME_WAIT and the port is unavailable on next launch.
  try {
    const forceShutdown = globalThis.__ottoForceShutdown;
    if (typeof forceShutdown === "function") {
      forceShutdown();
      globalThis.__ottoForceShutdown = null;
      globalThis.__ottoServer = null;
    } else {
      const server = globalThis.__ottoServer;
      if (server && typeof server.close === "function") {
        server.close();
        globalThis.__ottoServer = null;
      }
    }
  } catch {
    // best-effort
  }

  // Clear only the Host's own session(s) — not Client sessions.
  // This ensures the Host must re-authenticate on next launch (HIPAA) while
  // Client sessions survive for invisible reconnection.
  try {
    const clearHostSessions = globalThis.__ottoClearHostSessions;
    if (typeof clearHostSessions === "function") clearHostSessions();
  } catch {
    // best-effort
  }
}

let beforeQuitInProgress = false;

app.on("before-quit", async (event) => {
  if (updateInstallInProgress) {
    // _performUpdateInstall already ran the graceful teardown (final backup +
    // server shutdown) and is driving the quit via electron-updater. Step
    // aside: do NOT preventDefault and do NOT app.exit(0), or the installer and
    // relaunch are skipped.
    return;
  }
  if (beforeQuitInProgress) {
    // The first invocation already started teardown — block any subsequent
    // quit attempts (e.g., second Cmd-Q during the shutdown backup) so the
    // in-flight async work isn't yanked out from under us.
    event.preventDefault();
    return;
  }
  beforeQuitInProgress = true;

  let isHost = false;
  try {
    const config = _readConfig();
    isHost = config.mode === "host";

    if (isHost) {
      const getCount = globalThis.__ottoGetConnectedClientCount;
      const clientCount = typeof getCount === "function" ? getCount() : 0;
      if (clientCount > 0) {
        event.preventDefault();
        const { response } = await dialog.showMessageBox({
          type: "question",
          title: "Clients still connected",
          message: `${clientCount} Client computer${clientCount !== 1 ? "s are" : " is"} still connected.`,
          detail: "Closing Otto will disconnect them. They won't be able to make changes until you reopen it.",
          buttons: ["Close Anyway", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        });
        if (response !== 0) {
          // User canceled — leave auto-updater running and let the app
          // continue normally. Clear the quit flag so a later window-close
          // hides to tray again instead of being treated as a real quit.
          beforeQuitInProgress = false;
          app.__ottoQuitting = false;
          return;
        }
      } else {
        // Hold the quit so the final backup has time to land. Calling
        // app.quit() from inside an async before-quit handler can get stuck
        // on macOS, so we use app.exit() after we're done.
        event.preventDefault();
      }
    }
  } catch {
    // proceed with quit
  }

  // We're committed to quitting — mark it so the close interceptor and
  // window-all-closed treat this as a real quit, and stop the auto-updater.
  app.__ottoQuitting = true;
  stopAutoUpdater();

  if (isHost) {
    try {
      await _runShutdownBackup();
    } catch (error) {
      console.error("Shutdown backup failed:", error?.message || error);
      try { Sentry.captureException(error); } catch { /* sentry not configured */ }
    }
    _runShutdown();
    app.exit(0);
    return;
  }

  _runShutdown();
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
    mainWindow.show();
    mainWindow.focus();
  } else if (!_isSetupComplete()) {
    // Relaunched mid-setup (or after abandoning it) — focus/reopen the setup
    // window instead of booting a half-configured app.
    _createSetupWindow();
  } else {
    // Window was destroyed while the app stayed resident (e.g. a Windows client
    // closed to tray and the user relaunched the exe). Reopen it from config —
    // _showMainWindow handles the destroyed → relaunch path.
    _showMainWindow();
  }
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  if (!_isSetupComplete()) {
    _setAppMenu(getDefaultConfig());
    _createSetupWindow();
    return;
  }

  const config = _readConfig();
  void launchMainWindowForConfig(config, { showBootWindow: false });
});
