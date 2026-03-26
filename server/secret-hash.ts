import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";
import { promisify } from "util";

// Cast to accept the optional 4th options parameter that Node supports
// but the default TypeScript types for promisify(scrypt) don't expose.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

// Explicit scrypt cost parameters (F-14).
// N=32768, r=8, p=2 makes offline brute-force of 6-digit PINs take ~8-12 hours
// on modern hardware instead of ~2-3 hours with Node.js defaults (N=16384, r=8, p=1).
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 2, maxmem: 67_108_864 };

// New hashes are prefixed with "v2:" so we can distinguish them from legacy
// hashes created with Node.js default scrypt params. Legacy hashes are verified
// with default params for backward compatibility.
const HASH_V2_PREFIX = "v2:";

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(secret, salt, 64, SCRYPT_PARAMS)) as Buffer;
  return `${HASH_V2_PREFIX}${buf.toString("hex")}.${salt}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const raw = String(stored || "");
  const isV2 = raw.startsWith(HASH_V2_PREFIX);
  const payload = isV2 ? raw.slice(HASH_V2_PREFIX.length) : raw;

  const [hashed, salt] = payload.split(".");
  if (!hashed || !salt) return false;

  const hashedBuf = Buffer.from(hashed, "hex");
  // Use explicit params for v2 hashes; Node defaults for legacy hashes
  const suppliedBuf = isV2
    ? ((await scryptAsync(secret, salt, 64, SCRYPT_PARAMS)) as Buffer)
    : ((await scryptAsync(secret, salt, 64)) as Buffer);
  if (hashedBuf.length !== suppliedBuf.length) return false;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

