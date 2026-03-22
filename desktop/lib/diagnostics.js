import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";

export function sanitizeConfigForSupport(config) {
  const cloned = { ...(config || {}) };
  if (typeof cloned.pairingCode === "string" && cloned.pairingCode) cloned.pairingCode = "[REDACTED]";
  if (typeof cloned.trustedFingerprint256 === "string" && cloned.trustedFingerprint256) cloned.trustedFingerprint256 = "[REDACTED]";
  return cloned;
}

export function readErrorLogSummary(limit = 200, { getErrorLogPath }) {
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

export function summarizeOutboxItems(items) {
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

function fetchJson(urlString) {
  return new Promise((resolve) => {
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
}

export async function showDiagnostics({ app, dialog, clipboard, shell, readConfig, readOutboxItems, canEncryptOutbox, getConfigPath, getSqlitePath, getLocalBackupDir, getStartupLogPath, getErrorLogPath, getOutboxPath }) {
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

export async function exportSupportBundle({ app, dialog, shell, readConfig, readOutboxItems, getConfigPath, getSqlitePath, getStartupLogPath, getErrorLogPath, getOutboxPath, APP_DISPLAY_NAME }) {
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
    errors: readErrorLogSummary(200, { getErrorLogPath }),
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

export function computeHostInfo({ getHostTlsInfo, pairingCodeFromFingerprintHex }) {
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

export async function showHostAddresses({ dialog, clipboard, computeHostInfo: getInfo }) {
  const info = getInfo();
  const unique = info.urls;
  const pairingCode = info.pairingCode;

  const message = (() => {
    if (unique.length === 0) {
      return "No LAN address found. Make sure this computer is connected to the office network (Wi\u2011Fi/Ethernet).";
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
