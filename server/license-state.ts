import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes, X509Certificate } from "crypto";
import type { LicenseSnapshot, LicenseState, LicenseMode, LicenseOfficeStatus } from "./license-types";

const LICENSE_FILE_NAME = "license.json";
const ACTIVATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days to complete activation
const CHECKIN_OUTAGE_GRACE_MS = 1000 * 60 * 60 * 24 * 7; // tolerate portal outages for 7 days
const SUBSCRIPTION_GRACE_MS = 1000 * 60 * 60 * 24 * 3; // 3 days after subscription period expires

function getDataDir(): string {
  return process.env.OTTO_DATA_DIR || path.join(os.homedir(), ".otto-job-tracker");
}

export function getLicenseStatePath(): string {
  return path.join(getDataDir(), LICENSE_FILE_NAME);
}

function normalizeFingerprint(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-fA-F0-9]/g, "")
    .toLowerCase();
}

function computeHostFingerprintFromTlsCert(): string | null {
  const certPath = process.env.OTTO_TLS_CERT_PATH;
  if (!certPath) return null;
  if (!fs.existsSync(certPath)) return null;
  try {
    const certPem = fs.readFileSync(certPath, "utf-8");
    const fp = new X509Certificate(certPem).fingerprint256;
    const normalized = normalizeFingerprint(fp);
    return normalized || null;
  } catch {
    return null;
  }
}

function generateInstallationId(): string {
  return randomBytes(16).toString("hex");
}

export function loadLicenseState(): LicenseState {
  const statePath = getLicenseStatePath();
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as LicenseState;
    }
  } catch {
    // ignore
  }

  return {
    installationId: "",
    hostFingerprint256: "",
  };
}

export function saveLicenseState(state: LicenseState): void {
  const statePath = getLicenseStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function ensureLicenseState(): LicenseState {
  const existing = loadLicenseState();

  const installationId = typeof existing.installationId === "string" ? existing.installationId : "";
  const hostFingerprint256 =
    typeof existing.hostFingerprint256 === "string" ? existing.hostFingerprint256 : "";

  const computedFingerprint =
    computeHostFingerprintFromTlsCert() ||
    (hostFingerprint256 ? normalizeFingerprint(hostFingerprint256) : null) ||
    null;

  const next: LicenseState = {
    ...existing,
    installationId: installationId || generateInstallationId(),
    hostFingerprint256: computedFingerprint || installationId || existing.installationId || "unknown",
    firstRunAt: typeof existing.firstRunAt === "number" && existing.firstRunAt > 0 ? existing.firstRunAt : Date.now(),
  };

  // Normalize host fingerprint for consistent comparisons.
  next.hostFingerprint256 = normalizeFingerprint(next.hostFingerprint256) || "unknown";

  saveLicenseState(next);
  return next;
}

export function computeLicenseSnapshot(state: LicenseState): LicenseSnapshot {
  const officeStatus: LicenseOfficeStatus | "UNKNOWN" =
    state.officeStatus === "ACTIVE" || state.officeStatus === "DISABLED" ? state.officeStatus : "UNKNOWN";

  const offsetMs = typeof state.serverTimeOffsetMs === "number" ? state.serverTimeOffsetMs : 0;
  const nowServerTime = Date.now() + offsetMs;

  const hostTokenPresent = Boolean(state.hostToken && typeof state.hostToken === "string" && state.hostToken.length > 0);
  const activatedAt = typeof state.activatedAt === "number" ? state.activatedAt : null;
  const lastSuccessfulCheckinAt = typeof state.lastSuccessfulCheckinAt === "number" ? state.lastSuccessfulCheckinAt : null;
  const nextCheckinDueAt = typeof state.nextCheckinDueAt === "number" ? state.nextCheckinDueAt : null;

  const activationGraceEndsAtLocal =
    typeof state.firstRunAt === "number" && state.firstRunAt > 0 ? state.firstRunAt + ACTIVATION_GRACE_MS : null;

  let mode: LicenseMode = "UNACTIVATED";
  let writeAllowed = true;
  let message = "Activation required";
  let graceEndsAt: number | null = activationGraceEndsAtLocal;

  if (state.tokenInvalid) {
    mode = "INVALID";
    writeAllowed = false;
    message = "License is no longer valid. Please re-activate this Host.";
  } else if (officeStatus === "DISABLED") {
    mode = "DISABLED";
    writeAllowed = false;
    message = "Office is disabled. Otto Tracker is in read-only mode.";
  } else if (!hostTokenPresent) {
    graceEndsAt = activationGraceEndsAtLocal;
    if (activationGraceEndsAtLocal && Date.now() > activationGraceEndsAtLocal) {
      mode = "READ_ONLY";
      writeAllowed = false;
      message = "Activation not completed. Otto Tracker is in read-only mode.";
    } else {
      mode = "GRACE";
      writeAllowed = true;
      message = "Activation not yet verified. Otto Tracker will become read-only after the grace period.";
    }
  } else if (nextCheckinDueAt) {
    if (nowServerTime <= nextCheckinDueAt) {
      mode = "ACTIVE";
      writeAllowed = true;
      message = "License active";
    } else {
      const lastOk = lastSuccessfulCheckinAt || nextCheckinDueAt;
      const outageGraceEndsAt = lastOk ? lastOk + CHECKIN_OUTAGE_GRACE_MS : null;

      if (outageGraceEndsAt && nowServerTime <= outageGraceEndsAt) {
        mode = "GRACE";
        writeAllowed = true;
        graceEndsAt = outageGraceEndsAt;
        message = "License check-in overdue. Otto Tracker will keep working while it retries.";
      } else {
        mode = "READ_ONLY";
        writeAllowed = false;
        graceEndsAt = outageGraceEndsAt;
        message = "License check-in overdue. Otto Tracker is in read-only mode.";
      }
    }
  } else if (lastSuccessfulCheckinAt) {
    // Fallback if portal didn't return nextCheckinDueAt for some reason.
    const fallbackDue = lastSuccessfulCheckinAt + CHECKIN_OUTAGE_GRACE_MS;
    if (nowServerTime <= fallbackDue) {
      mode = "ACTIVE";
      writeAllowed = true;
      graceEndsAt = null;
      message = "License active";
    } else {
      mode = "READ_ONLY";
      writeAllowed = false;
      graceEndsAt = fallbackDue;
      message = "License check-in overdue. Otto Tracker is in read-only mode.";
    }
  } else {
    // Activated but we haven't successfully checked in yet.
    graceEndsAt = activationGraceEndsAtLocal;
    if (activationGraceEndsAtLocal && Date.now() > activationGraceEndsAtLocal) {
      mode = "READ_ONLY";
      writeAllowed = false;
      message = "License check-in required. Otto Tracker is in read-only mode.";
    } else {
      mode = "GRACE";
      writeAllowed = true;
      message = "License check-in pending. Otto Tracker will become read-only after the grace period.";
    }
  }

  // Subscription billing cycle enforcement: if the subscription period has ended
  // and the 3-day grace window has passed, block writes regardless of check-in status.
  if (writeAllowed && hostTokenPresent && typeof state.currentPeriodEnd === "number" && state.currentPeriodEnd > 0) {
    const subscriptionGraceEndsAt = state.currentPeriodEnd + SUBSCRIPTION_GRACE_MS;
    if (Date.now() > subscriptionGraceEndsAt) {
      mode = "READ_ONLY";
      writeAllowed = false;
      graceEndsAt = subscriptionGraceEndsAt;
      message = "Subscription period has expired. Please renew to continue using Otto Tracker.";
    } else if (Date.now() > state.currentPeriodEnd && mode === "ACTIVE") {
      mode = "GRACE";
      graceEndsAt = subscriptionGraceEndsAt;
      message = "Subscription renewal pending. Otto Tracker will become read-only if not renewed.";
    }
  }

  const lastError = typeof state.lastError === "string" && state.lastError.trim() ? state.lastError.trim() : null;

  return {
    mode,
    writeAllowed,
    message,
    nowServerTime,
    installationId: state.installationId,
    hostFingerprint256: state.hostFingerprint256,
    officeStatus,
    hostTokenPresent,
    activatedAt,
    lastSuccessfulCheckinAt,
    nextCheckinDueAt,
    graceEndsAt,
    lastError,
    currentInviteCodeLast4: typeof state.currentInviteCodeLast4 === "string" ? state.currentInviteCodeLast4 : null,
    paymentRequired: Boolean(state.paymentRequired),
  };
}
