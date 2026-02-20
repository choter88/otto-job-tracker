import { randomUUID } from "crypto";

const LOGIN_ID_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

export function normalizeLoginId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");
}

export function isValidLoginId(value: string): boolean {
  const normalized = normalizeLoginId(value);
  return LOGIN_ID_REGEX.test(normalized);
}

export function validateLoginId(value: string): string | null {
  const normalized = normalizeLoginId(value);
  if (!normalized) return "Login ID is required";
  if (normalized.length < 3) return "Login ID must be at least 3 characters";
  if (normalized.length > 32) return "Login ID must be 32 characters or fewer";
  if (!LOGIN_ID_REGEX.test(normalized)) {
    return "Login ID can only use letters, numbers, '.', '-', or '_'";
  }
  return null;
}

export function isValidSixDigitPin(value: string): boolean {
  return /^\d{6}$/.test(String(value || "").trim());
}

export function deriveLoginIdCandidates(params: {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  id?: string | null;
}): string[] {
  const emailLocal = String(params.email || "").trim().toLowerCase().split("@")[0] || "";
  const first = String(params.firstName || "").trim().toLowerCase();
  const last = String(params.lastName || "").trim().toLowerCase();
  const id = String(params.id || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  const bases = [
    normalizeLoginId(emailLocal),
    normalizeLoginId([first, last].filter(Boolean).join(".")),
    normalizeLoginId([first, last].filter(Boolean).join("_")),
    normalizeLoginId(first),
    normalizeLoginId(last),
    normalizeLoginId(`user-${id.slice(0, 8)}`),
    "user",
  ];

  return Array.from(new Set(bases.filter((candidate) => candidate.length >= 3)));
}

export function buildLocalAuthEmail(loginId: string, officeId: string): string {
  const normalizedLoginId = normalizeLoginId(loginId) || "user";
  const officeTag = String(officeId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "office";

  return `local+${normalizedLoginId}.${officeTag}.${randomUUID().slice(0, 8)}@otto.local`;
}
