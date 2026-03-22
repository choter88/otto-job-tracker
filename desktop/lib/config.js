import fs from "fs";
import os from "os";
import path from "path";

const LEGACY_APP_DIR_NAME = "rest-express";

export function getStartupLogPath(app) {
  return path.join(app.getPath("userData"), "startup.log");
}

export function logStartup(app, message, error) {
  try {
    const stamp = new Date().toISOString();
    const details =
      error && typeof error === "object"
        ? error.stack || error.message || JSON.stringify(error)
        : error
          ? String(error)
          : "";
    fs.mkdirSync(path.dirname(getStartupLogPath(app)), { recursive: true, mode: 0o700 });
    fs.appendFileSync(getStartupLogPath(app), `[${stamp}] ${message}\n${details}\n\n`, { mode: 0o600 });
  } catch {
    // ignore
  }
}

export function migrateLegacyUserDataDir(app) {
  try {
    const appData = app.getPath("appData");
    const legacyPath = path.join(appData, LEGACY_APP_DIR_NAME);
    const newPath = app.getPath("userData");
    if (legacyPath === newPath) return;
    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true, mode: 0o700 });
      fs.renameSync(legacyPath, newPath);
      logStartup(app, `Migrated user data to ${newPath}`);
    }
  } catch (error) {
    logStartup(app, "Failed to migrate legacy user data folder", error);
  }
}

export function getErrorLogPath() {
  if (process.env.OTTO_ERROR_LOG_PATH) return process.env.OTTO_ERROR_LOG_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
  return path.join(dataDir, "error_log.json");
}

export function loadDevDotEnv(app) {
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

export function getDefaultConfig() {
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
    localBackupEnabled: true,
    localBackupRetention: 7,
    localBackupLastAt: 0,
    localBackupLastPath: "",
    localBackupLastError: "",
  };
}

export function getConfigPath(app) {
  return path.join(app.getPath("userData"), "otto-config.json");
}

export function getDataDir(app) {
  return path.join(app.getPath("userData"), "data");
}

export function getOutboxPath(app) {
  return path.join(app.getPath("userData"), "otto-outbox.json");
}

export function getSqlitePath(app) {
  return process.env.OTTO_SQLITE_PATH || path.join(getDataDir(app), "otto.sqlite");
}

export function getLocalBackupDir(app) {
  return path.join(app.getPath("userData"), "backups");
}

export function readConfig(app) {
  try {
    const raw = fs.readFileSync(getConfigPath(app), "utf-8");
    return { ...getDefaultConfig(), ...JSON.parse(raw) };
  } catch {
    return getDefaultConfig();
  }
}

export function writeConfig(app, config) {
  fs.mkdirSync(path.dirname(getConfigPath(app)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(getConfigPath(app), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function applyOfflineDefaults(app) {
  if (!process.env.PORT) process.env.PORT = "5150";
  if (!process.env.OTTO_LISTEN_HOST) process.env.OTTO_LISTEN_HOST = "0.0.0.0";
  if (!process.env.OTTO_AIRGAP) process.env.OTTO_AIRGAP = "true";
  if (!process.env.OTTO_LAN_ONLY) process.env.OTTO_LAN_ONLY = "true";
  if (!process.env.OTTO_DATA_DIR) process.env.OTTO_DATA_DIR = getDataDir(app);
  if (!process.env.OTTO_SQLITE_PATH) process.env.OTTO_SQLITE_PATH = getSqlitePath(app);
  // ensureSessionSecret is called separately by TLS module
}

export function applyLicenseEgressAllowlist() {
  const raw = String(process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  const hostnames = new Set();
  try {
    const url = new URL(raw);
    if (url.hostname) hostnames.add(url.hostname);
  } catch {
    hostnames.add("ottojobtracker.com");
  }

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

export function getPortalBaseUrl() {
  const raw = String(process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  try {
    return new URL(raw);
  } catch {
    return new URL("https://ottojobtracker.com");
  }
}
