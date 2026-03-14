import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, screen, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { createCipheriv, createDecipheriv, createHash, randomBytes, X509Certificate } from "crypto";
import selfsigned from "selfsigned";
import Database from "better-sqlite3";

const APP_DISPLAY_NAME = "Otto Tracker";
const LEGACY_APP_DIR_NAME = "rest-express";

app.setName(APP_DISPLAY_NAME);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guardedSessions = new WeakSet();
const tlsTrustByWebContentsId = new Map();
const tlsTrustBySession = new WeakMap();
const certVerifyInstalled = new WeakSet();
let cachedHostTlsInfo = null;
let automaticBackupInterval = null;
let backupWarningShown = false;
let mainWindow = null;
let setupWindow = null;
let appReadyForOpenEvents = false;
const pendingOpenUrls = [];
const pendingOpenFiles = [];
const MAIN_WINDOW_BASE_WIDTH = 1320;
const MAIN_WINDOW_BASE_HEIGHT = 864;
const MAIN_WINDOW_BASE_MIN_WIDTH = 1320;
const MAIN_WINDOW_BASE_MIN_HEIGHT = 864;
const HOST_DISCOVERY_TIMEOUT_MS = 1200;
const HOST_DISCOVERY_CONCURRENCY = 36;
const HOST_DISCOVERY_MAX_CANDIDATES = 1024;

process.on("uncaughtException", (error) => {
  logStartup("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  logStartup("Unhandled rejection", error);
});

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
    localBackupEnabled: true,
    localBackupRetention: 7,
    localBackupLastAt: 0,
    localBackupLastPath: "",
    localBackupLastError: "",
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

function getLocalBackupDir() {
  return path.join(app.getPath("userData"), "backups");
}

function normalizeHex(value) {
  if (!value) return "";
  return String(value).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

async function handleOpenUrl(_url) {
  // Legacy activation code URL handling removed. Placeholder for future deep-link support.
}

async function handleOpenFile(_filePath) {
  // Legacy .otto-license file handling removed.
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

function normalizeFingerprint256Hex(value) {
  const normalized = normalizeHex(value);
  if (normalized.length < 64) return "";
  return normalized.slice(0, 64);
}

function fingerprintHexFromCertificate(cert) {
  if (!cert || typeof cert !== "object") return "";

  const fromFingerprint256 = normalizeFingerprint256Hex(cert.fingerprint256);
  if (fromFingerprint256) return fromFingerprint256;

  if (typeof cert.data === "string" && cert.data.trim()) {
    try {
      const fromPem = new X509Certificate(cert.data).fingerprint256;
      const normalizedFromPem = normalizeFingerprint256Hex(fromPem);
      if (normalizedFromPem) return normalizedFromPem;
    } catch {
      // ignore
    }
  }

  if (Buffer.isBuffer(cert.raw)) {
    const fromRaw = createHash("sha256").update(cert.raw).digest("hex").toUpperCase();
    const normalizedFromRaw = normalizeFingerprint256Hex(fromRaw);
    if (normalizedFromRaw) return normalizedFromRaw;
  }

  const fromFingerprint = normalizeFingerprint256Hex(cert.fingerprint);
  if (fromFingerprint) return fromFingerprint;

  return "";
}

function getPeerFingerprintHex(socket) {
  if (!socket) return "";

  try {
    if (typeof socket.getPeerX509Certificate === "function") {
      const cert = socket.getPeerX509Certificate();
      const fromX509 = fingerprintHexFromCertificate(cert);
      if (fromX509) return fromX509;
      if (cert?.raw && Buffer.isBuffer(cert.raw)) {
        const fromRaw = createHash("sha256").update(cert.raw).digest("hex").toUpperCase();
        const normalizedFromRaw = normalizeFingerprint256Hex(fromRaw);
        if (normalizedFromRaw) return normalizedFromRaw;
      }
    }
  } catch {
    // ignore and try legacy API
  }

  try {
    if (typeof socket.getPeerCertificate === "function") {
      const detailed = socket.getPeerCertificate(true);
      const fromDetailed = fingerprintHexFromCertificate(detailed);
      if (fromDetailed) return fromDetailed;

      const basic = socket.getPeerCertificate();
      const fromBasic = fingerprintHexFromCertificate(basic);
      if (fromBasic) return fromBasic;
    }
  } catch {
    // ignore
  }

  return "";
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

function normalizeDiscoveryHostUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return raw;
  return `https://${raw}`;
}

function getLocalSubnetHostCandidates() {
  const nets = os.networkInterfaces();
  const hosts = new Set();

  for (const iface of Object.values(nets).flat().filter(Boolean)) {
    if (iface.family !== "IPv4" || iface.internal) continue;
    if (!isPrivateIpv4(iface.address)) continue;

    const octets = iface.address.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      continue;
    }

    const [a, b, c, self] = octets;
    for (let host = 1; host <= 254; host += 1) {
      if (host === self) continue;
      hosts.add(`${a}.${b}.${c}.${host}`);
      if (hosts.size >= HOST_DISCOVERY_MAX_CANDIDATES) {
        return Array.from(hosts);
      }
    }
  }

  return Array.from(hosts);
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const output = [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) break;
      const value = await worker(items[currentIndex], currentIndex);
      if (value) output.push(value);
    }
  });

  await Promise.all(runners);
  return output;
}

async function requestJsonWithFingerprint(targetUrl, options = {}) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return { ok: false, status: 0, json: null, fingerprintHex: "", error: "Invalid URL" };
  }

  const timeoutMs = (() => {
    const value = Number(options?.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : HOST_DISCOVERY_TIMEOUT_MS;
  })();
  const method = String(options?.method || "GET").trim().toUpperCase() || "GET";
  const body = typeof options?.body === "string" ? options.body : "";
  const expectedPairingHex = normalizePairingCodeHex(options?.expectedPairingCode || options?.expectedPairingHex || "");
  const allowMissingFingerprint = Boolean(options?.allowMissingFingerprint);
  const extraHeaders = options?.headers && typeof options.headers === "object" ? options.headers : {};
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;
  const port = url.port || (isHttps ? "443" : "80");

  return await new Promise((resolve) => {
    let settled = false;
    let totalTimeoutHandle = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (totalTimeoutHandle) {
        clearTimeout(totalTimeoutHandle);
        totalTimeoutHandle = null;
      }
      resolve(result);
    };

    const req = client.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method,
        // Use a one-off socket so TLS certificate details are available on every request.
        agent: false,
        rejectUnauthorized: false,
        headers: {
          Accept: "application/json",
          ...extraHeaders,
        },
      },
      (res) => {
        const fingerprintHex = isHttps
          ? getPeerFingerprintHex(res.socket) || getPeerFingerprintHex(req.socket)
          : "";
        let body = "";

        res.on("data", (chunk) => {
          if (body.length < 262_144) {
            body += chunk.toString();
          }
        });

        res.on("end", () => {
          const status = Number(res.statusCode) || 0;
          if (isHttps && expectedPairingHex) {
            if (!fingerprintHex) {
              if (!allowMissingFingerprint) {
                done({
                  ok: false,
                  status: 496,
                  json: null,
                  fingerprintHex: "",
                  error: "Could not read the Host certificate.",
                });
                return;
              }
            } else if (!fingerprintHex.startsWith(expectedPairingHex)) {
              done({
                ok: false,
                status: 495,
                json: null,
                fingerprintHex: fingerprintHex || "",
                error: "Pairing code does not match this Host.",
              });
              return;
            }
          }

          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }

          done({
            ok: status >= 200 && status < 300,
            status,
            json,
            fingerprintHex: fingerprintHex || "",
            error: null,
          });
        });
      },
    );

    req.on("error", (error) => {
      done({
        ok: false,
        status: 0,
        json: null,
        fingerprintHex: "",
        error: String(error?.message || error || "Network request failed"),
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Connection timed out"));
    });

    totalTimeoutHandle = setTimeout(() => {
      done({
        ok: false,
        status: 0,
        json: null,
        fingerprintHex: "",
        error: "Connection timed out",
      });
      try {
        req.destroy(new Error("Connection timed out"));
      } catch {
        // ignore
      }
    }, timeoutMs + 50);

    if (body) {
      req.write(body);
    }
    req.end();
  });
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
    // Some platforms intermittently do not expose peer cert details on resumed TLS sessions.
    // In that case, continue to Host approval for final confirmation.
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
      : "Connection successful. Waiting for Host computer approval…",
  };
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

function getOutboxKeyPath() {
  return path.join(app.getPath("userData"), "outbox-key.bin");
}

function getOrCreateOutboxKey() {
  const keyPath = getOutboxKeyPath();
  try {
    if (fs.existsSync(keyPath)) {
      const raw = fs.readFileSync(keyPath);
      if (Buffer.isBuffer(raw) && raw.length === 32) return raw;
    }
  } catch {
    // ignore
  }

  try {
    const key = randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  } catch {
    return null;
  }
}

function encryptOutboxString(plaintext) {
  const text = typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext ?? "");

  if (canEncryptOutbox()) {
    return {
      mode: "safeStorage",
      payload: safeStorage.encryptString(text).toString("base64"),
    };
  }

  const key = getOrCreateOutboxKey();
  if (!key) {
    throw new Error("Outbox encryption unavailable (no key storage)");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return { mode: "aes-256-gcm", payload: packed };
}

function decryptOutboxString(mode, payload) {
  const m = String(mode || "");
  const p = typeof payload === "string" ? payload : "";
  if (!p) return null;

  if (m === "safeStorage") {
    if (!canEncryptOutbox()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(p, "base64"));
    } catch {
      return null;
    }
  }

  if (m === "aes-256-gcm") {
    const key = getOrCreateOutboxKey();
    if (!key) return null;
    try {
      const packed = Buffer.from(p, "base64");
      if (packed.length < 12 + 16) return null;
      const iv = packed.subarray(0, 12);
      const tag = packed.subarray(12, 28);
      const ciphertext = packed.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      return plaintext;
    } catch {
      return null;
    }
  }

  return null;
}

function readOutboxItems() {
  const outboxPath = getOutboxPath();
  if (!fs.existsSync(outboxPath)) return [];

  try {
    const raw = fs.readFileSync(outboxPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];

    if (parsed.encrypted === true) {
      const mode = parsed.mode;
      const payload = parsed.payload;
      const decrypted = decryptOutboxString(mode, payload);
      if (!decrypted) return [];
      const items = JSON.parse(decrypted);
      return Array.isArray(items) ? items : [];
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // Migrate legacy plaintext outbox to encrypted storage.
    if (items.length > 0) {
      try {
        writeOutboxItems(items);
      } catch {
        // ignore migration failures
      }
    }
    return items;
  } catch {
    return [];
  }
}

function writeOutboxItems(items) {
  const outboxPath = getOutboxPath();
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true, mode: 0o700 });

  const capped = Array.isArray(items) ? items.slice(-500) : [];

  const encrypted = encryptOutboxString(JSON.stringify(capped));
  const payload = {
    version: 2,
    encrypted: true,
    mode: encrypted.mode,
    payload: encrypted.payload,
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

  void import(pathToFileURL(serverEntry).href).catch(async (error) => {
    logStartup("Host server failed to start", error);
    try {
      await dialog.showMessageBox({
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
    app.quit();
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

          const certFpHex = fingerprintHexFromCertificate(request?.certificate);
          if (!certFpHex) return callback(-3);

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

    const certFpHex = fingerprintHexFromCertificate(certificate);
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

function getDisplayWorkAreaForBounds(bounds) {
  try {
    if (bounds) {
      return screen.getDisplayMatching(bounds)?.workAreaSize || null;
    }
    return screen.getPrimaryDisplay()?.workAreaSize || null;
  } catch {
    return null;
  }
}

function getMainWindowBaselineSize() {
  const workArea = getDisplayWorkAreaForBounds();
  const displayWidth = Number(workArea?.width) || MAIN_WINDOW_BASE_WIDTH;
  const displayHeight = Number(workArea?.height) || MAIN_WINDOW_BASE_HEIGHT;

  const minWidth = Math.min(MAIN_WINDOW_BASE_MIN_WIDTH, displayWidth);
  const minHeight = Math.min(MAIN_WINDOW_BASE_MIN_HEIGHT, displayHeight);
  const width = Math.max(minWidth, Math.min(MAIN_WINDOW_BASE_WIDTH, displayWidth));
  const height = Math.max(minHeight, Math.min(MAIN_WINDOW_BASE_HEIGHT, displayHeight));

  return { width, height, minWidth, minHeight };
}

function setMainWindowMinWidth(win, widthInput) {
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

function createWindow(targetUrl, config) {
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
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      spellcheck: false,
      partition: isClient ? "otto-client" : "persist:otto-host",
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
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

      try {
        const isCertError =
          typeof errorDescription === "string" &&
          (errorDescription.includes("ERR_CERT") || errorDescription.toLowerCase().includes("certificate"));

        const buttons = isClient ? ["Retry", "Change Connection…", "Close"] : ["Retry", "Close"];
        const messageBoxOpts = {
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

function createBootWindow() {
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
  win.loadFile(path.join(__dirname, "boot.html"));
  setupNoInternetNetworkGuard(win.webContents.session);
  return win;
}

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    if (setupWindow.isMinimized()) setupWindow.restore();
    setupWindow.focus();
    return setupWindow;
  }

  const win = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Setup`,
    width: 720,
    height: 520,
    minWidth: 720,
    minHeight: 520,
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
  setupWindow = win;
  win.on("closed", () => {
    if (setupWindow === win) setupWindow = null;
  });
  return win;
}

function getTargetUrlForConfig(config) {
  const port = process.env.PORT || "5150";
  if (config.mode === "host") {
    return `${app.isPackaged ? "https" : "http"}://127.0.0.1:${port}`;
  }
  return config.hostUrl;
}

async function launchMainWindowForConfig(config, options = {}) {
  const showBootWindow = options?.showBootWindow !== false;
  setAppMenu(config);

  let bootWindow = null;
  if (config.mode === "host" && showBootWindow) {
    bootWindow = createBootWindow();
  }

  try {
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

    const targetUrl = getTargetUrlForConfig(config);
    createWindow(targetUrl, config);

    if (config.mode === "host") {
      await maybePromptForBackupFolder();
      await maybeWarnAboutBackups();
      scheduleAutomaticBackups();
    }

    return true;
  } finally {
    if (bootWindow && !bootWindow.isDestroyed()) {
      bootWindow.close();
    }
  }
}

function setupContextMenu(win) {
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
  const outboxItems = readOutboxItems();
  const outboxCount = outboxItems.length;
  const outboxOldestAt = outboxItems.reduce((min, item) => {
    const ts = Number(item?.createdAt) || 0;
    if (!ts) return min;
    return min ? Math.min(min, ts) : ts;
  }, 0);
  const outboxNewestAt = outboxItems.reduce((max, item) => {
    const ts = Number(item?.createdAt) || 0;
    return Math.max(max, ts);
  }, 0);
  const outboxFailures = outboxItems.filter((i) => i?.lastError).length;
  const outboxMaxAttempts = outboxItems.reduce((max, item) => {
    const attempts = Number(item?.attempts) || 0;
    return Math.max(max, attempts);
  }, 0);
  const safeStorageAvailable = canEncryptOutbox();

  const fetchJson = async (urlString) => {
    return await new Promise((resolve) => {
      let url;
      try {
        url = new URL(urlString);
      } catch {
        return resolve(null);
      }

      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        {
          method: "GET",
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + (url.search || ""),
          timeout: 3000,
          rejectUnauthorized: false, // Host uses self-signed cert
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              const json = JSON.parse(text);
              resolve(json);
            } catch {
              resolve(null);
            }
          });
        },
      );

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch {
          // ignore
        }
        resolve(null);
      });
      req.end();
    });
  };

  const licenseSnapshot = await fetchJson(`${config.hostUrl}/api/license/status`);

  const formatWhen = (ts) => (ts ? new Date(ts).toLocaleString() : "never");
  const networkBackupStatus =
    config.mode === "host"
      ? config.backupEnabled === false
        ? "disabled"
        : config.backupDir
          ? config.backupLastError
            ? "error"
            : config.backupLastAt
              ? `last ${formatWhen(config.backupLastAt)}`
              : "configured"
          : "not set up"
      : null;

  const localBackupStatus =
    config.mode === "host"
      ? config.localBackupEnabled === false
        ? "disabled"
        : config.localBackupLastError
          ? "error"
          : config.localBackupLastAt
            ? `last ${formatWhen(config.localBackupLastAt)}`
            : "pending"
      : null;

  const details = [
    `App version: ${appVersion}`,
    `Mode: ${config.mode}`,
    `Host URL: ${config.hostUrl}`,
    `Protocol: ${protocol}`,
    `Port: ${port}`,
    `License: ${licenseSnapshot?.mode ? `${licenseSnapshot.mode} (${licenseSnapshot.message || ""})` : "unavailable"}`,
    config.mode === "host" ? `Backups (network): ${networkBackupStatus}` : null,
    config.mode === "host" && config.backupDir ? `Network backup folder: ${config.backupDir}` : null,
    config.mode === "host" && config.backupLastPath ? `Network backup last file:\n${config.backupLastPath}` : null,
    config.mode === "host" && config.backupLastError ? `Network backup last error: ${config.backupLastError}` : null,
    config.mode === "host" ? `Backups (local): ${localBackupStatus}` : null,
    config.mode === "host" && config.localBackupEnabled !== false ? `Local backup folder: ${getLocalBackupDir()}` : null,
    config.mode === "host" && config.localBackupLastPath ? `Local backup last file:\n${config.localBackupLastPath}` : null,
    config.mode === "host" && config.localBackupLastError ? `Local backup last error: ${config.localBackupLastError}` : null,
    `Offline outbox: ${outboxCount} pending (encrypted; safeStorage=${safeStorageAvailable ? "yes" : "no"})`,
    outboxCount ? `Outbox oldest: ${formatWhen(outboxOldestAt)}` : null,
    outboxCount ? `Outbox newest: ${formatWhen(outboxNewestAt)}` : null,
    outboxCount ? `Outbox failures: ${outboxFailures} (max attempts=${outboxMaxAttempts})` : null,
    "",
    `User data: ${app.getPath("userData")}`,
    `Config: ${getConfigPath()}`,
    `SQLite: ${getSqlitePath()}`,
    `Data dir: ${dataDir}`,
    "",
    `Startup log: ${getStartupLogPath()}`,
    `Error log: ${getErrorLogPath()}`,
  ]
    .filter(Boolean)
    .join("\n");

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

function sanitizeConfigForSupport(config) {
  const cloned = { ...(config || {}) };
  if (typeof cloned.pairingCode === "string" && cloned.pairingCode) cloned.pairingCode = "[REDACTED]";
  if (typeof cloned.trustedFingerprint256 === "string" && cloned.trustedFingerprint256) cloned.trustedFingerprint256 = "[REDACTED]";
  return cloned;
}

function readErrorLogSummary(limit = 200) {
  const logPath = getErrorLogPath();
  try {
    if (!fs.existsSync(logPath)) return { total: 0, last24Hours: 0, lastHour: 0, byStatusCode: {}, byPath: {} };
    const raw = fs.readFileSync(logPath, "utf-8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return { total: 0, last24Hours: 0, lastHour: 0, byStatusCode: {}, byPath: {} };

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const stats = {
      total: entries.length,
      last24Hours: 0,
      lastHour: 0,
      byStatusCode: {},
      byPath: {},
    };

    for (const entry of entries.slice(0, Math.max(0, Number(limit) || 200))) {
      const ts = new Date(entry?.timestamp || 0).getTime();
      if (ts > dayAgo) stats.last24Hours += 1;
      if (ts > hourAgo) stats.lastHour += 1;

      const status = Number(entry?.statusCode) || 0;
      if (status) stats.byStatusCode[status] = (stats.byStatusCode[status] || 0) + 1;

      const rawPath = String(entry?.path || "");
      const normalized = rawPath.replace(/\/[0-9a-f-]{36}/gi, "/:id").replace(/\/\d+/g, "/:id");
      if (normalized) stats.byPath[normalized] = (stats.byPath[normalized] || 0) + 1;
    }

    return stats;
  } catch {
    return { total: 0, last24Hours: 0, lastHour: 0, byStatusCode: {}, byPath: {} };
  }
}

function summarizeOutboxItems(items) {
  const list = Array.isArray(items) ? items : [];
  const oldestAt = list.reduce((min, item) => {
    const ts = Number(item?.createdAt) || 0;
    if (!ts) return min;
    return min ? Math.min(min, ts) : ts;
  }, 0);

  const newestAt = list.reduce((max, item) => {
    const ts = Number(item?.createdAt) || 0;
    return Math.max(max, ts);
  }, 0);

  const failures = list.filter((i) => i?.lastError).length;
  const maxAttempts = list.reduce((max, item) => {
    const attempts = Number(item?.attempts) || 0;
    return Math.max(max, attempts);
  }, 0);

  const sample = list.slice(-50).map((item) => ({
    id: item?.id,
    origin: item?.origin,
    method: item?.method,
    url: item?.url,
    createdAt: item?.createdAt,
    attempts: item?.attempts,
    lastError: item?.lastError,
  }));

  return {
    count: list.length,
    oldestAt: oldestAt || null,
    newestAt: newestAt || null,
    failures,
    maxAttempts,
    sample,
  };
}

async function exportSupportBundle() {
  const config = readConfig();
  const appVersion = app.getVersion();
  const port = process.env.PORT || "5150";
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "http";

  const stamp = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  })();

  const defaultName = `otto-support-bundle-${stamp}.json`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export Support Bundle",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (canceled || !filePath) return;

  const fetchJson = async (urlString) => {
    return await new Promise((resolve) => {
      let url;
      try {
        url = new URL(urlString);
      } catch {
        return resolve(null);
      }

      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        {
          method: "GET",
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + (url.search || ""),
          timeout: 3000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              const json = JSON.parse(text);
              resolve(json);
            } catch {
              resolve(null);
            }
          });
        },
      );

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch {
          // ignore
        }
        resolve(null);
      });
      req.end();
    });
  };

  const licenseSnapshot = await fetchJson(`${config.hostUrl}/api/license/status`);

  const bundle = {
    generatedAt: new Date().toISOString(),
    app: {
      name: APP_DISPLAY_NAME,
      version: appVersion,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions?.electron,
      chrome: process.versions?.chrome,
      node: process.versions?.node,
    },
    runtime: {
      mode: config.mode,
      hostUrl: config.hostUrl,
      protocol,
      port,
      env: {
        OTTO_AIRGAP: process.env.OTTO_AIRGAP,
        OTTO_LAN_ONLY: process.env.OTTO_LAN_ONLY,
        OTTO_TLS: process.env.OTTO_TLS,
        OTTO_COOKIE_SECURE: process.env.OTTO_COOKIE_SECURE,
        OTTO_LICENSE_BASE_URL: process.env.OTTO_LICENSE_BASE_URL,
        OTTO_EGRESS_ALLOWLIST: process.env.OTTO_EGRESS_ALLOWLIST,
        OTTO_DISABLE_SMS: process.env.OTTO_DISABLE_SMS,
        OTTO_ENABLE_AI_SUMMARY: process.env.OTTO_ENABLE_AI_SUMMARY,
        OTTO_ALLOW_PHI_EGRESS: process.env.OTTO_ALLOW_PHI_EGRESS,
      },
    },
    paths: {
      userData: app.getPath("userData"),
      config: getConfigPath(),
      sqlite: getSqlitePath(),
      dataDir: process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker"),
      startupLog: getStartupLogPath(),
      errorLog: getErrorLogPath(),
      outbox: getOutboxPath(),
    },
    config: sanitizeConfigForSupport(config),
    license: licenseSnapshot,
    outbox: summarizeOutboxItems(readOutboxItems()),
    errors: readErrorLogSummary(),
    note:
      "This support bundle is non-PHI by design: it does not include the SQLite database, patient/job records, or offline outbox request bodies.",
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), { mode: 0o600 });
    await dialog.showMessageBox({
      type: "info",
      message: "Support bundle exported.",
      detail: `Saved to:\n${filePath}\n\nThis bundle does not include patient/job data.`,
    });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not export support bundle.",
      detail: String(error?.message || error),
    });
  }
}

ipcMain.handle("otto:config:get", async () => readConfig());
ipcMain.handle("otto:config:set", async (_event, configInput) => {
  const hadConfigFileBeforeWrite = fs.existsSync(getConfigPath());
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
  if (!hadConfigFileBeforeWrite) {
    if (config.mode === "host") {
      // Host first-time setup: start the server but keep the setup window open.
      // setup.html will call bootstrap, then otto:setup:complete to open the main window.
      try {
        await maybeStartHostServer();
        const protocol = app.isPackaged ? "https" : "http";
        const port = process.env.PORT || "5150";
        const readiness = await waitForHostReady({ protocol, host: "127.0.0.1", port, timeoutMs: 30000 });
        if (!readiness.ok) {
          return { ok: false, relaunched: false, message: "Server did not start in time." };
        }
      } catch (err) {
        return { ok: false, relaunched: false, message: "Could not start the server." };
      }
      return { ok: true, relaunched: false };
    }

    // Client first-time setup: open main window immediately (no bootstrap needed).
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

ipcMain.handle("otto:setup:complete", async () => {
  // Called by setup.html after Host bootstrap succeeds.
  // Opens the main window and closes the setup window.
  const config = readConfig();
  setAppMenu(config);
  const targetUrl = getTargetUrlForConfig(config);
  createWindow(targetUrl, config);

  if (config.mode === "host") {
    await maybePromptForBackupFolder();
    await maybeWarnAboutBackups();
    scheduleAutomaticBackups();
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
  await showHostAddresses();
  return { ok: true };
});

ipcMain.handle("otto:hostInfo:get", async () => {
  return computeHostInfo();
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

ipcMain.handle("otto:diagnostics:show", async () => {
  await showDiagnostics();
  return { ok: true };
});

ipcMain.handle("otto:supportBundle:export", async () => {
  await exportSupportBundle();
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
  return await portalValidateInviteCodeDesktop(payload);
});

function getPortalBaseUrl() {
  const raw = String(process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  try {
    return new URL(raw);
  } catch {
    return new URL("https://ottojobtracker.com");
  }
}

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

/**
 * Authenticate with the portal and return the raw token + offices list.
 * Used by the Host setup flow to sign in and select a practice.
 */
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
    const offices = Array.isArray(json.offices)
      ? json.offices.map((o) => ({
          officeId: o.officeId || o.portalOfficeId || o.id || "",
          officeName: o.officeName || o.name || "",
          role: o.role || "",
        }))
      : [];

    if (!token) {
      return { ok: false, message: "Portal did not return an authentication token." };
    }

    return { ok: true, token, expiresAt, offices };
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

/**
 * Validate an invite code with the portal. Used by the Client setup flow.
 * Generates an installationId for the client if one doesn't exist yet.
 */
async function portalValidateInviteCodeDesktop(payload) {
  const { inviteCode } = payload || {};
  if (!inviteCode || !/^\d{6}$/.test(String(inviteCode).trim())) {
    return { ok: false, message: "Invite code must be 6 digits." };
  }

  // Generate a stable installationId for this client
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
      // Non-fatal — use in-memory only
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

function computeHostInfo() {
  const port = process.env.PORT || "5150";
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "http";
  const nets = os.networkInterfaces();

  const addresses = Object.values(nets)
    .flat()
    .filter(Boolean)
    .filter((n) => n.family === "IPv4" && !n.internal)
    .map((n) => `${protocol}://${n.address}:${port}`);

  const urls = Array.from(new Set(addresses)).sort();
  const pairingCode =
    protocol === "https"
      ? pairingCodeFromFingerprintHex(getHostTlsInfo().fingerprint256)
      : "";

  return {
    protocol,
    port: Number(port) || 0,
    urls,
    pairingCode,
  };
}

async function showHostAddresses() {
  const info = computeHostInfo();
  const unique = info.urls;
  const pairingCode = info.pairingCode;

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

async function runBackupToLocalFolder({ interactive, reason }) {
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
  if (config.localBackupEnabled === false) return;

  const backupDir = getLocalBackupDir();
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    const updated = readConfig();
    writeConfig({ ...updated, localBackupLastError: error?.message || String(error) });
    if (interactive) {
      await dialog.showMessageBox({
        type: "error",
        message: "Local backup failed.",
        detail: `Folder:\n${backupDir}\n\nError:\n${error?.message || error}`,
      });
    }
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
        localBackupLastAt: Date.now(),
        localBackupLastPath: finalPath,
        localBackupLastError: "",
      });

      enforceBackupRetention(backupDir, updated.localBackupRetention);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }

      const updated = readConfig();
      writeConfig({
        ...updated,
        localBackupLastError: error?.message || String(error),
      });

      if (interactive) {
        await dialog.showMessageBox({
          type: "error",
          message: "Local backup failed.",
          detail: `Folder:\n${backupDir}\n\nError:\n${error?.message || error}`,
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
      message: "Local backup saved.",
      detail:
        `Saved to:\n${finalPath}\n\n` +
        "This is a local backup on the Host computer. For disaster recovery, set up a shared office network backup folder too.",
    });
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
      if (config.backupDir) return config.backupDir;
      if (config.localBackupEnabled !== false) return getLocalBackupDir();
      return app.getPath("documents");
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

  const ONE_DAY_MS = 1000 * 60 * 60 * 24;
  const now = Date.now();
  const localEnabled = config.localBackupEnabled !== false;
  const networkEnabled = config.backupEnabled !== false && Boolean(config.backupDir);

  const localLastAt = Number(config.localBackupLastAt) || 0;
  const networkLastAt = Number(config.backupLastAt) || 0;

  const dueLocal = localEnabled && now - localLastAt > ONE_DAY_MS;
  const dueNetwork = networkEnabled && now - networkLastAt > ONE_DAY_MS;

  if (dueLocal) {
    setTimeout(() => {
      runBackupToLocalFolder({ interactive: false, reason: "startup" }).catch(() => {});
    }, 30_000);
  }

  if (dueNetwork) {
    setTimeout(() => {
      runBackupToNetworkFolder({ interactive: false, reason: "startup" }).catch(() => {});
    }, 30_000);
  }

  if (!localEnabled && !networkEnabled) return;

  automaticBackupInterval = setInterval(() => {
    runBackupToLocalFolder({ interactive: false, reason: "scheduled" }).catch(() => {});
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
      "Local backups run automatically on this Host, but a shared network backup helps you recover if the Host computer is replaced.\n\n" +
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

  const now = Date.now();
  const localHasError = config.localBackupEnabled !== false && Boolean(config.localBackupLastError);

  const networkHasFolder = Boolean(config.backupDir);
  const networkEnabled = config.backupEnabled !== false;
  const networkLastAt = Number(config.backupLastAt) || 0;
  const networkTooOld = networkHasFolder && (!networkLastAt || now - networkLastAt > 1000 * 60 * 60 * 24 * 2); // 2 days
  const networkHasError = networkHasFolder && Boolean(config.backupLastError);

  const networkNeedsAttention = networkEnabled && networkHasFolder && (networkTooOld || networkHasError);
  const localNeedsAttention = localHasError;

  if (!networkNeedsAttention && !localNeedsAttention) return;
  backupWarningShown = true;

  const detailParts = [];
  if (networkNeedsAttention) {
    detailParts.push("Network backups");
    if (networkLastAt) {
      detailParts.push(`Last backup: ${new Date(networkLastAt).toLocaleString()}`);
    } else {
      detailParts.push("Last backup: never");
    }
    if (config.backupLastPath) {
      detailParts.push(`Last backup file:\n${config.backupLastPath}`);
    }
    if (networkHasError) {
      detailParts.push(`Last error:\n${config.backupLastError}`);
    }
  }

  if (localNeedsAttention) {
    if (detailParts.length) detailParts.push("");
    detailParts.push("Local backups");
    detailParts.push(`Folder:\n${getLocalBackupDir()}`);
    detailParts.push(`Last error:\n${config.localBackupLastError}`);
  }

  const actions = [];
  if (networkNeedsAttention) {
    actions.push({ label: "Back Up Now", run: () => runBackupToNetworkFolder({ interactive: true, reason: "manual" }) });
    actions.push({
      label: "Choose Backup Folder…",
      run: async () => {
        const chosen = await chooseNetworkBackupFolder();
        if (chosen) scheduleAutomaticBackups();
      },
    });
  }
  if (localNeedsAttention) {
    actions.push({ label: "Retry Local Backup", run: () => runBackupToLocalFolder({ interactive: true, reason: "manual" }) });
  }
  actions.push({ label: "OK", run: null });

  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: actions.map((a) => a.label),
    defaultId: 0,
    cancelId: actions.length - 1,
    message: "Backups need attention",
    detail:
      detailParts.join("\n\n") +
      "\n\nDaily backups help you recover if the Host computer is replaced.",
  });

  const picked = actions[result.response];
  if (picked?.run) {
    await picked.run();
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
        { label: "Export Support Bundle…", click: () => exportSupportBundle() },
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
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
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

  const hasConfigFile = fs.existsSync(getConfigPath());
  if (!hasConfigFile) {
    setAppMenu(getDefaultConfig());
    createSetupWindow();
    return;
  }

  const config = readConfig();
  await launchMainWindowForConfig(config, { showBootWindow: true });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // cleanup on quit
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

  const hasConfigFile = fs.existsSync(getConfigPath());
  if (!hasConfigFile) {
    setAppMenu(getDefaultConfig());
    createSetupWindow();
    return;
  }

  const config = readConfig();
  void launchMainWindowForConfig(config, { showBootWindow: false });
});
