import os from "os";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { OTTO_DEFAULT_PORT } from "@shared/constants";
import type { LicenseSnapshot, LicenseState, OttoPlan } from "./license-types";
import { DEFAULT_PLAN } from "./license-types";
import { ensureLicenseState, saveLicenseState, computeLicenseSnapshot } from "./license-state";
import { portalCheckin, portalActivate } from "./license-client";
import type { LicenseActivateResult, CheckinMetrics } from "./license-client";

function logToFile(msg: string): void {
  try {
    const logPath = process.env.OTTO_STARTUP_LOG_PATH || path.join(process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker"), "startup.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* best-effort */ }
}

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
  if (!state) {
    state = ensureLicenseState();
    logToFile(`[checkin] License state loaded from ${process.env.OTTO_DATA_DIR || "~/.otto-job-tracker"} — hostToken=${state.hostToken ? "present" : "MISSING"}`);
  }
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

  // Publish this Host's LAN addresses to the portal immediately, so a Client can
  // pair from the portal the moment the Host finishes setup. The scheduler's
  // startup check-in fires 10s after boot — but any setup taking longer than 10s
  // (the common case) means it already ran before the hostToken existed and was
  // skipped, and the next scheduled check-in is routine/idle-gated (30min–4h out).
  // That left a window where the portal had no Host address and Clients fell back
  // to a LAN scan. forceCheckin bypasses those gates and carries
  // localAddresses/pairingCode/tlsFingerprint256 (metrics inside it are
  // best-effort, so this still publishes even mid-bootstrap before the DB is set
  // up). Best-effort: forceCheckin self-handles portal errors and won't throw on
  // them; the try/catch guards the rare unexpected throw so a check-in hiccup can
  // never fail an already-committed activation. The scheduler remains the backstop.
  try {
    await forceCheckin();
  } catch {
    // non-fatal — activation succeeded; the scheduler will publish on its next run
  }

  return { snapshot, activateResult: result };
}

function getLocalAddresses(): string[] {
  const port = process.env.PORT || String(OTTO_DEFAULT_PORT);
  const nets = os.networkInterfaces();
  // Emit bare `host:port`, NOT `scheme://host:port`. The portal sits behind an
  // edge WAF (Google Cloud Armor / OWASP RFI/SSRF managed rule) that returns a
  // 403 for any request body containing a `scheme://<IP-literal>:<port>` URL —
  // which silently blocked every check-in at the edge before it reached the app.
  // Consumers re-add the scheme: the portal's buildDiscovery() and the desktop's
  // normalizeDiscoveryHostUrl() both prepend `https://` for schemeless entries,
  // and Hosts always run TLS so https is the correct default. Do NOT reintroduce
  // a `scheme://` prefix here or check-ins will start 403ing again.
  return Object.values(nets)
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => Boolean(n))
    .filter((n) => n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254."))
    .map((n) => `${n.address}:${port}`);
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
      orderSheetImports: stats.orderSheetImports,
      jobAttachments: stats.jobAttachments,
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
      // Log to startup.log (console.log is discarded in packaged Electron)
      const logMsg = `[${new Date().toISOString()}] [checkin] Analytics: since=${since.toISOString()} dailyActivity=${checkinPayload.metrics.dailyActivity.length} days, rawEvents=${checkinPayload.metrics.rawEvents.length}\n`;
      try {
        const logPath = process.env.OTTO_STARTUP_LOG_PATH || path.join(process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker"), "startup.log");
        fs.appendFileSync(logPath, logMsg);
      } catch { /* best-effort */ }
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

/**
 * Check-in scheduling rules:
 *
 * 1. MINIMUM_INTERVAL (2 min) — hard floor between any two check-in attempts
 *    to prevent flooding the portal during error loops or rapid restarts.
 *
 * 2. ROUTINE_INTERVAL (30 min) — normal cadence when the office is active.
 *    Frequent enough for fresh analytics without excessive load.
 *
 * 3. Idle gate: once we've already checked in after the most recent tracked
 *    event, there's nothing new to ship — skip until activity resumes.
 *    HEARTBEAT_INTERVAL puts a ceiling on how long a powered-on but idle
 *    host can go without pinging the portal so the dashboard's "host
 *    healthy" indicator stays current.
 *
 * 4. On startup: first check-in fires after 10 seconds, subject only to the
 *    2-minute minimum interval — NOT the routine interval or idle gate.
 *    This ensures a freshly launched app syncs quickly even before any
 *    user activity has been recorded.
 */
const MINIMUM_INTERVAL_MS  = 1000 * 60 * 2;        // 2 minutes — hard floor
const ROUTINE_INTERVAL_MS  = 1000 * 60 * 30;       // 30 minutes — normal cadence
const HEARTBEAT_INTERVAL_MS = 1000 * 60 * 60 * 4;  // 4 hours — idle ceiling
const POLL_INTERVAL_MS     = 1000 * 60 * 5;        // 5 minutes — how often we evaluate

async function maybeCheckin(isStartup = false): Promise<void> {
  const current = getState();
  if (!current.hostToken) { logToFile("[checkin] Skipped: no hostToken"); return; }

  const now = Date.now();

  // Hard floor: never check in more often than every 2 minutes
  const lastAttempt = typeof current.lastAttemptAt === "number" ? current.lastAttemptAt : 0;
  if (lastAttempt && now - lastAttempt < MINIMUM_INTERVAL_MS) {
    logToFile(`[checkin] Skipped: minimum interval (last attempt ${Math.round((now - lastAttempt) / 1000)}s ago)`);
    return;
  }

  if (!isStartup) {
    const lastOk = typeof current.lastSuccessfulCheckinAt === "number" ? current.lastSuccessfulCheckinAt : 0;
    const sinceLastOk = lastOk ? now + (current.serverTimeOffsetMs || 0) - lastOk : Infinity;

    // Routine cadence: don't check in more often than every 30 minutes
    if (sinceLastOk < ROUTINE_INTERVAL_MS) {
      return; // Silent skip — routine interval not yet reached
    }

    // Idle gate: if nothing has been tracked since the last successful
    // check-in, there's nothing new to ship. Skip until activity resumes
    // OR the heartbeat ceiling is hit (so dashboard "last seen" stays
    // current for powered-on but unused machines).
    const { getLastEventAt } = await import("./usage-tracker");
    const lastEvent = getLastEventAt();
    const idleSinceLastOk = lastOk > 0 && lastEvent <= lastOk;
    if (idleSinceLastOk && sinceLastOk < HEARTBEAT_INTERVAL_MS) {
      logToFile(`[checkin] Skipped: idle (no events since last check-in ${Math.round(sinceLastOk / 60000)}min ago)`);
      return;
    }
  }

  logToFile("[checkin] Running forceCheckin...");
  try {
    await forceCheckin();
    logToFile("[checkin] forceCheckin completed");
  } catch (e: any) {
    logToFile(`[checkin] forceCheckin error: ${e?.message}`);
  }
}

export function startLicenseScheduler(): void {
  if (checkinTimer) return;
  logToFile("[checkin] License scheduler started, first check-in in 10s");

  // Initial check-in soon after startup (bypasses routine interval, respects minimum)
  setTimeout(() => {
    void maybeCheckin(true);
  }, 10_000);

  // Periodic evaluation — checks every 5 minutes whether a check-in is due
  checkinTimer = setInterval(() => {
    void maybeCheckin();
  }, POLL_INTERVAL_MS);
}
