import os from "os";
import { OTTO_DEFAULT_PORT } from "@shared/constants";
import type { LicenseSnapshot, LicenseState } from "./license-types";
import { ensureLicenseState, saveLicenseState, computeLicenseSnapshot } from "./license-state";
import { portalActivate, portalCheckin, portalConsumeHostClaim, portalIssueAndConsume, portalValidateHostClaim } from "./license-client";
import type { ClaimValidationResult } from "./license-client";

let state: LicenseState | null = null;
let checkinTimer: NodeJS.Timeout | null = null;

function getState(): LicenseState {
  if (!state) state = ensureLicenseState();
  return state;
}

function updateState(patch: Partial<LicenseState>): LicenseState {
  const next: LicenseState = { ...getState(), ...patch };
  state = next;
  saveLicenseState(next);
  return next;
}

export function getLicenseSnapshot(): LicenseSnapshot {
  return computeLicenseSnapshot(getState());
}

export function getHostToken(): string {
  return getState().hostToken || "";
}

const ACTIVATION_ALLOWED = /^[A-HJ-NP-Z2-9]+$/;
const SETUP_CODE_ALLOWED = /^[A-Z0-9_-]+$/i;

function normalizeActivationCode(input: string): string {
  const raw = String(input || "").trim().toUpperCase();
  const stripped = raw.replace(/[^A-Z0-9]/g, "").replace(/[IO01]/g, "");
  if (stripped.length === 16 && ACTIVATION_ALLOWED.test(stripped)) {
    return stripped.match(/.{1,4}/g)?.join("-") || stripped;
  }
  return raw;
}

function compactActivationCode(input: string): string {
  const stripped = String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[IO01]/g, "");
  return stripped;
}

function isLikelyActivationCode(input: string): boolean {
  const compacted = compactActivationCode(input);
  return compacted.length === 16 && ACTIVATION_ALLOWED.test(compacted);
}

function normalizeSetupCode(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const normalizedActivation = normalizeActivationCode(raw);
  if (isLikelyActivationCode(normalizedActivation)) {
    return normalizedActivation;
  }

  const compact = raw.replace(/\s+/g, "");
  if (!compact) return "";
  if (!SETUP_CODE_ALLOWED.test(compact)) return raw;
  return compact.toUpperCase();
}

function applyActivationResult(result: {
  hostToken: string;
  status: "ACTIVE" | "DISABLED";
  serverTime: number;
  nextCheckinDueAt: number;
}): LicenseSnapshot {
  updateState({
    hostToken: result.hostToken,
    officeStatus: result.status,
    activatedAt: Date.now(),
    lastSuccessfulCheckinAt: result.serverTime,
    nextCheckinDueAt: result.nextCheckinDueAt,
    serverTimeOffsetMs: result.serverTime - Date.now(),
    lastAttemptAt: Date.now(),
    lastError: "",
    tokenInvalid: false,
  });

  return getLicenseSnapshot();
}

function throwLicenseRequestError(err: { statusCode?: number; code?: string; message?: string }): never {
  const message = err?.code ? `${err.code}: ${err.message || "Request failed"}` : err?.message || "Request failed";
  throw Object.assign(new Error(message), { statusCode: err?.statusCode || 500, code: err?.code || "REQUEST_FAILED" });
}

export async function activateLicense(activationCode: string): Promise<LicenseSnapshot> {
  const trimmed = normalizeActivationCode(activationCode);
  if (!trimmed) {
    throw new Error("Activation Code is required");
  }

  const current = getState();
  let result = await portalActivate({
    activationCode: trimmed,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

  if (!result.ok && result.error?.code === "INVALID_CODE") {
    const compacted = compactActivationCode(trimmed);
    if (compacted && compacted !== trimmed) {
      result = await portalActivate({
        activationCode: compacted,
        installationId: current.installationId,
        hostFingerprint256: current.hostFingerprint256,
        appVersion: process.env.npm_package_version,
      });
    }
  }

  if (!result.ok) {
    throwLicenseRequestError(result.error);
  }

  return applyActivationResult(result);
}

export async function activateHostForSetup(setupCode: string): Promise<LicenseSnapshot> {
  const trimmed = normalizeSetupCode(setupCode);
  if (!trimmed) {
    throw new Error("Host Claim Code is required");
  }

  if (isLikelyActivationCode(trimmed)) {
    return activateLicense(trimmed);
  }

  const current = getState();
  const result = await portalConsumeHostClaim({
    claimCode: trimmed,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

  if (!result.ok) {
    throwLicenseRequestError(result.error);
  }

  return applyActivationResult(result);
}

export async function activateHostWithPortalToken(portalToken: string, officeId: string): Promise<LicenseSnapshot> {
  if (!portalToken) throw new Error("Portal token is required");
  if (!officeId) throw new Error("Office ID is required");

  const current = getState();
  const result = await portalIssueAndConsume({
    portalToken,
    officeId,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

  if (!result.ok) {
    throwLicenseRequestError(result.error);
  }

  return applyActivationResult(result);
}

export type ClaimValidation = {
  validated: boolean;
  office?: ClaimValidationResult extends { ok: true } ? ClaimValidationResult["office"] : never;
  portalUser?: ClaimValidationResult extends { ok: true } ? ClaimValidationResult["portalUser"] : never;
  fallbackToConsume?: boolean;
};

export async function validateClaimForSetup(setupCode: string): Promise<ClaimValidation> {
  const trimmed = normalizeSetupCode(setupCode);
  if (!trimmed) {
    throw new Error("Host Claim Code is required");
  }

  // Legacy activation codes don't support validation — fall back to single-submit flow
  if (isLikelyActivationCode(trimmed)) {
    return { validated: true, fallbackToConsume: true };
  }

  const current = getState();
  const result = await portalValidateHostClaim({
    claimCode: trimmed,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATE_NOT_SUPPORTED") {
      // Old portal without validate endpoint — fall back to single-submit flow
      return { validated: true, fallbackToConsume: true };
    }
    throwLicenseRequestError(result.error);
  }

  return {
    validated: true,
    office: result.office,
    portalUser: result.portalUser,
  };
}

function getLocalAddresses(): string[] {
  const port = process.env.PORT || String(OTTO_DEFAULT_PORT);
  const protocol = process.env.OTTO_TLS === "true" ? "https" : "http";
  const nets = os.networkInterfaces();
  return Object.values(nets)
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => Boolean(n))
    .filter((n) => n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254."))
    .map((n) => `${protocol}://${n.address}:${port}`);
}

function computePairingCode(fingerprint256: string): string {
  const hex = fingerprint256.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (hex.length < 12) return "";
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export async function forceCheckin(): Promise<LicenseSnapshot> {
  const current = getState();
  if (!current.hostToken) {
    return getLicenseSnapshot();
  }

  const checkinPayload: Parameters<typeof portalCheckin>[0] = {
    hostToken: current.hostToken,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  };

  // Include connection info so the portal can assist client discovery
  const addrs = getLocalAddresses();
  if (addrs.length > 0) checkinPayload.localAddresses = addrs;
  const pc = computePairingCode(current.hostFingerprint256);
  if (pc) checkinPayload.pairingCode = pc;
  if (current.hostFingerprint256) checkinPayload.tlsFingerprint256 = current.hostFingerprint256;

  const result = await portalCheckin(checkinPayload);

  if (!result.ok) {
    const err = result.error;
    if (err.statusCode === 401) {
      updateState({ tokenInvalid: true, lastError: `${err.code}: ${err.message}`, lastAttemptAt: Date.now() });
      return getLicenseSnapshot();
    }

    updateState({ lastError: `${err.code}: ${err.message}`, lastAttemptAt: Date.now() });
    return getLicenseSnapshot();
  }

  updateState({
    officeStatus: result.status,
    lastSuccessfulCheckinAt: result.serverTime,
    nextCheckinDueAt: result.nextCheckinDueAt,
    serverTimeOffsetMs: result.serverTime - Date.now(),
    lastAttemptAt: Date.now(),
    lastError: "",
    tokenInvalid: false,
  });

  return getLicenseSnapshot();
}

async function maybeCheckin(): Promise<void> {
  const current = getState();
  if (!current.hostToken) return;

  const now = Date.now();
  const lastAttempt = typeof current.lastAttemptAt === "number" ? current.lastAttemptAt : 0;
  if (lastAttempt && now - lastAttempt < 1000 * 60 * 15) return; // 15 min backoff

  const lastOk = typeof current.lastSuccessfulCheckinAt === "number" ? current.lastSuccessfulCheckinAt : 0;
  // At most one successful check-in every 4 hours unless forced.
  if (lastOk && now + (current.serverTimeOffsetMs || 0) - lastOk < 1000 * 60 * 60 * 4) return;

  try {
    await forceCheckin();
  } catch {
    // forceCheckin handles state updates; ignore.
  }
}

export function startLicenseScheduler(): void {
  if (checkinTimer) return;
  // Kick off soon after startup, then periodically.
  setTimeout(() => {
    void maybeCheckin();
  }, 10_000);

  checkinTimer = setInterval(() => {
    void maybeCheckin();
  }, 1000 * 60 * 60); // hourly (internal throttles)
}

export function stopLicenseScheduler(): void {
  if (checkinTimer) clearInterval(checkinTimer);
  checkinTimer = null;
}
