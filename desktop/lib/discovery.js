import os from "os";
import http from "http";
import https from "https";
import { createHash, X509Certificate } from "crypto";

export const HOST_DISCOVERY_TIMEOUT_MS = 1200;
export const HOST_DISCOVERY_CONCURRENCY = 36;
export const HOST_DISCOVERY_MAX_CANDIDATES = 1024;

export function isPrivateIpv4(hostname) {
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

export function isLocalHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h === "127.0.0.1") return true;
  if (!h.includes(".")) return true;
  if (h.endsWith(".local")) return true;
  return false;
}

export function normalizeDiscoveryHostUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return raw;
  return `https://${raw}`;
}

export function getLocalSubnetHostCandidates() {
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

export async function mapWithConcurrency(items, concurrency, worker) {
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

export function normalizeHex(value) {
  if (!value) return "";
  return String(value).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

export function formatFingerprint256(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return "";
  const pairs = normalized.match(/.{1,2}/g) || [];
  return pairs.join(":");
}

export function pairingCodeFromFingerprintHex(hex) {
  const normalized = normalizeHex(hex);
  if (normalized.length < 12) return "";
  const code = normalized.slice(0, 12);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

export function normalizePairingCodeHex(value) {
  const normalized = normalizeHex(value);
  return normalized.length >= 12 ? normalized.slice(0, 12) : normalized;
}

export function normalizeFingerprint256Hex(value) {
  const normalized = normalizeHex(value);
  if (normalized.length < 64) return "";
  return normalized.slice(0, 64);
}

export function fingerprintHexFromCertificate(cert) {
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

export function getPeerFingerprintHex(socket) {
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

export async function requestJsonWithFingerprint(targetUrl, options = {}) {
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
