import fs from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export function canEncryptOutbox(safeStorage) {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function getOutboxKeyPath(app) {
  return path.join(app.getPath("userData"), "outbox-key.bin");
}

export function getOrCreateOutboxKey(app) {
  const keyPath = getOutboxKeyPath(app);
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

export function encryptOutboxString(plaintext, { safeStorage, app }) {
  const text = typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext ?? "");

  if (canEncryptOutbox(safeStorage)) {
    return {
      mode: "safeStorage",
      payload: safeStorage.encryptString(text).toString("base64"),
    };
  }

  const key = getOrCreateOutboxKey(app);
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

export function decryptOutboxString(mode, payload, { safeStorage, app }) {
  const m = String(mode || "");
  const p = typeof payload === "string" ? payload : "";
  if (!p) return null;

  if (m === "safeStorage") {
    if (!canEncryptOutbox(safeStorage)) return null;
    try {
      return safeStorage.decryptString(Buffer.from(p, "base64"));
    } catch {
      return null;
    }
  }

  if (m === "aes-256-gcm") {
    const key = getOrCreateOutboxKey(app);
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

export function readOutboxItems({ app, safeStorage, getOutboxPath }) {
  const outboxPath = getOutboxPath(app);
  if (!fs.existsSync(outboxPath)) return [];

  try {
    const raw = fs.readFileSync(outboxPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];

    if (parsed.encrypted === true) {
      const mode = parsed.mode;
      const payload = parsed.payload;
      const decrypted = decryptOutboxString(mode, payload, { safeStorage, app });
      if (!decrypted) return [];
      const items = JSON.parse(decrypted);
      return Array.isArray(items) ? items : [];
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // Migrate legacy plaintext outbox to encrypted storage.
    if (items.length > 0) {
      try {
        writeOutboxItems(items, { app, safeStorage, getOutboxPath });
      } catch {
        // ignore migration failures
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function writeOutboxItems(items, { app, safeStorage, getOutboxPath }) {
  const outboxPath = getOutboxPath(app);
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true, mode: 0o700 });

  const capped = Array.isArray(items) ? items.slice(-500) : [];

  const encrypted = encryptOutboxString(JSON.stringify(capped), { safeStorage, app });
  const payload = {
    version: 2,
    encrypted: true,
    mode: encrypted.mode,
    payload: encrypted.payload,
  };

  fs.writeFileSync(outboxPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}
