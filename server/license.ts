import type { LicenseSnapshot, LicenseState } from "./license-types";
import { ensureLicenseState, saveLicenseState, computeLicenseSnapshot } from "./license-state";
import { portalActivate, portalCheckin } from "./license-client";

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

export async function activateLicense(activationCode: string): Promise<LicenseSnapshot> {
  const trimmed = String(activationCode || "").trim();
  if (!trimmed) {
    throw new Error("Activation Code is required");
  }

  const current = getState();
  const result = await portalActivate({
    activationCode: trimmed,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

  if (!result.ok) {
    const err = result.error;
    const message = err.code ? `${err.code}: ${err.message}` : err.message;
    throw Object.assign(new Error(message), { statusCode: err.statusCode, code: err.code });
  }

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

export async function forceCheckin(): Promise<LicenseSnapshot> {
  const current = getState();
  if (!current.hostToken) {
    return getLicenseSnapshot();
  }

  const result = await portalCheckin({
    hostToken: current.hostToken,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.npm_package_version,
  });

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

