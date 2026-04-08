import os from "os";
import { randomBytes } from "crypto";
import { OTTO_DEFAULT_PORT } from "@shared/constants";
import type { LicenseSnapshot, LicenseState, OttoPlan } from "./license-types";
import { DEFAULT_PLAN } from "./license-types";
import { ensureLicenseState, saveLicenseState, computeLicenseSnapshot } from "./license-state";
import { portalCheckin, portalActivate } from "./license-client";
import type { LicenseActivateResult, CheckinMetrics } from "./license-client";

let state: LicenseState | null = null;
let checkinTimer: NodeJS.Timeout | null = null;
let _onStateChange: (() => void) | null = null;

/**
 * In-memory plan cache — NOT stored in the SQLite job database.
 * Populated from the portal's check-in response.
 * Defaults to pro/unlimited if portal hasn't sent plan data yet (backward compat).
 */
let cachedPlan: OttoPlan = { ...DEFAULT_PLAN };

/** Get the currently cached plan. */
export function getCachedPlan(): OttoPlan {
  return cachedPlan;
}

/** Register a callback invoked whenever license state changes (e.g. to invalidate caches). */
export function onLicenseStateChange(cb: () => void): void {
  _onStateChange = cb;
}

function getState(): LicenseState {
  if (!state) state = ensureLicenseState();
  return state;
}

function updateState(patch: Partial<LicenseState>): LicenseState {
  const next: LicenseState = { ...getState(), ...patch };
  state = next;
  saveLicenseState(next);
  _onStateChange?.();
  return next;
}

export function getLicenseSnapshot(): LicenseSnapshot {
  return computeLicenseSnapshot(getState());
}

export function getHostToken(): string {
  return getState().hostToken || "";
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

export type ActivateHostResult = {
  snapshot: LicenseSnapshot;
  activateResult: LicenseActivateResult;
};

export async function activateHostWithPortalToken(portalToken: string, officeId: string, opts?: { forceReplace?: boolean }): Promise<ActivateHostResult> {
  if (!portalToken) throw new Error("Portal token is required");
  if (!officeId) throw new Error("Office ID is required");

  const current = getState();
  // Generate an idempotency key so the portal can return a cached response
  // if we crash after portal commits but before we persist the hostToken.
  const idempotencyKey = randomBytes(16).toString("hex");
  const result = await portalActivate({
    portalToken,
    officeId,
    installationId: current.installationId,
    hostFingerprint256: current.hostFingerprint256,
    appVersion: process.env.OTTO_APP_VERSION || process.env.npm_package_version,
    idempotencyKey,
    forceReplace: opts?.forceReplace,
  });

  if (!result.ok) {
    throwLicenseRequestError(result.error);
  }

  updateState({ officeId });
  const snapshot = applyActivationResult(result);
  return { snapshot, activateResult: result };
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
    appVersion: process.env.OTTO_APP_VERSION || process.env.npm_package_version,
  };

  // Include connection info so the portal can assist client discovery
  const addrs = getLocalAddresses();
  if (addrs.length > 0) checkinPayload.localAddresses = addrs;
  const pc = computePairingCode(current.hostFingerprint256);
  if (pc) checkinPayload.pairingCode = pc;
  if (current.hostFingerprint256) checkinPayload.tlsFingerprint256 = current.hostFingerprint256;

  // Collect anonymous usage metrics (counts only, no PHI)
  try {
    const { storage } = await import("./storage");
    const { getConnectedClientCount } = await import("./sync-websocket");
    const { getActiveTabletSessionCount } = await import("./routes");
    const stats = await storage.getPlatformStats();
    checkinPayload.metrics = {
      activeJobs: stats.activeJobs,
      archivedJobs: stats.archivedJobs,
      totalUsers: stats.totalUsers,
      clientCount: getConnectedClientCount(),
      tabletCount: getActiveTabletSessionCount(),
      platform: process.platform,
    };

    // Attach daily activity aggregates (since last successful check-in or 7 days ago)
    try {
      const { getAggregatedDailyStats, getRawEventsSince, pruneOldEvents } = await import("./usage-tracker");
      const since = new Date(
        Math.max(
          current.lastSuccessfulCheckinAt || 0,
          Date.now() - 7 * 24 * 60 * 60 * 1000,
        ),
      );
      checkinPayload.metrics.dailyActivity = getAggregatedDailyStats(since);
      checkinPayload.metrics.rawEvents = getRawEventsSince(since);
      console.log(`[checkin] Analytics: since=${since.toISOString()} dailyActivity=${checkinPayload.metrics.dailyActivity.length} days, rawEvents=${checkinPayload.metrics.rawEvents.length}`);
      // Non-blocking cleanup of old raw events
      setTimeout(() => { try { pruneOldEvents(90); } catch {} }, 100);
    } catch {
      // Non-critical — daily activity is optional
    }
  } catch {
    // Non-critical — don't let metrics failure block check-in
  }

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

  const checkinPatch: Partial<LicenseState> = {
    officeStatus: result.status,
    lastSuccessfulCheckinAt: result.serverTime,
    nextCheckinDueAt: result.nextCheckinDueAt,
    serverTimeOffsetMs: result.serverTime - Date.now(),
    lastAttemptAt: Date.now(),
    lastError: "",
    tokenInvalid: false,
    currentInviteCodeLast4: result.currentInviteCodeLast4,
  };
  if (typeof result.currentPeriodEnd === "number" && result.currentPeriodEnd > 0) {
    checkinPatch.currentPeriodEnd = result.currentPeriodEnd;
  }

  // Update cached plan from portal response (backward compat: keep default if not present)
  if (result.plan) {
    cachedPlan = {
      clientSlots: result.plan.clientSlots,
      tabletSlots: result.plan.tabletSlots,
    };
  }

  // Store paymentRequired in license state
  if (typeof result.paymentRequired === "boolean") {
    checkinPatch.paymentRequired = result.paymentRequired;
  }

  updateState(checkinPatch);

  // Check if office is over the client slot limit and broadcast to clients
  if (cachedPlan.clientSlots < 999) {
    try {
      const { getRegisteredDeviceCount, broadcastToOffice } = await import("./sync-websocket");
      const { storage: store } = await import("./storage");
      const deviceCount = getRegisteredDeviceCount();
      const state = getState();

      let officeId = state.officeId;
      if (!officeId) {
        const offices = await store.getAllOffices();
        officeId = offices[0]?.id;
        if (officeId) updateState({ officeId });
      }

      if (deviceCount > cachedPlan.clientSlots) {
        if (!state.overLimitSince) {
          updateState({ overLimitSince: Date.now() });
        }
        const graceEndsAt = (state.overLimitSince || Date.now()) + 24 * 60 * 60 * 1000;
        if (officeId) {
          broadcastToOffice(officeId, {
            type: "over_limit",
            allowed: cachedPlan.clientSlots,
            connected: deviceCount,
            graceEndsAt,
          });
        }
      } else if (state.overLimitSince) {
        updateState({ overLimitSince: undefined });
        if (officeId) {
          broadcastToOffice(officeId, { type: "under_limit" });
        }
      }
    } catch { /* non-critical */ }
  }

  return getLicenseSnapshot();
}

async function maybeCheckin(): Promise<void> {
  const current = getState();
  if (!current.hostToken) return;

  const now = Date.now();
  const lastAttempt = typeof current.lastAttemptAt === "number" ? current.lastAttemptAt : 0;
  if (lastAttempt && now - lastAttempt < 1000 * 60 * 15) return; // 15 min backoff

  // Only check in during active hours (7am–9pm local time).
  // Outside these hours, skip entirely to save resources.
  const localHour = new Date(now).getHours();
  if (localHour < 7 || localHour >= 21) return;

  const lastOk = typeof current.lastSuccessfulCheckinAt === "number" ? current.lastSuccessfulCheckinAt : 0;
  // At most one successful check-in per hour during active hours.
  if (lastOk && now + (current.serverTimeOffsetMs || 0) - lastOk < 1000 * 60 * 60) return;

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
