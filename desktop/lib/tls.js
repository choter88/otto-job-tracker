import fs from "fs";
import path from "path";
import { randomBytes, X509Certificate } from "crypto";
import selfsigned from "selfsigned";
import { restrictToCurrentUser } from "./file-permissions.js";

let cachedHostTlsInfo = null;

export function getTlsDir(app) {
  return path.join(app.getPath("userData"), "tls");
}

export function getTlsKeyPath(app) {
  return path.join(getTlsDir(app), "otto-host.key.pem");
}

export function getTlsCertPath(app) {
  return path.join(getTlsDir(app), "otto-host.cert.pem");
}

export function getHostTlsInfo(app) {
  if (cachedHostTlsInfo) return cachedHostTlsInfo;

  const tlsDir = getTlsDir(app);
  const keyPath = getTlsKeyPath(app);
  const certPath = getTlsCertPath(app);

  fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
  restrictToCurrentUser(tlsDir, "dir");

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
      days: 825,    // Reduced from 3650 — aligns with Apple/browser max (F-15)
      keySize: 4096, // Increased from 2048 — stronger for long-lived certs (F-15)
    });

    keyPem = pems.private;
    certPem = pems.cert;

    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
    fs.writeFileSync(certPath, certPem, { mode: 0o600 });
    restrictToCurrentUser(keyPath);
    restrictToCurrentUser(certPath);
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

export function applyHostTlsEnv(app) {
  const tls = getHostTlsInfo(app);
  process.env.OTTO_TLS = "true";
  process.env.OTTO_TLS_KEY_PATH = tls.keyPath;
  process.env.OTTO_TLS_CERT_PATH = tls.certPath;
  process.env.OTTO_COOKIE_SECURE = "true";
  return tls;
}

export function ensureSessionSecret(app) {
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
  restrictToCurrentUser(secretPath);
  process.env.SESSION_SECRET = secret;
}
