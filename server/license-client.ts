export type ActivationOfficeInfo = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  portalOfficeId?: string;
};

export type ActivationPortalUser = {
  firstName?: string;
  lastName?: string;
  email?: string;
};

export type LicenseActivateResult = {
  ok: true;
  hostToken: string;
  serverTime: number;
  nextCheckinDueAt: number;
  status: "ACTIVE" | "DISABLED";
  office?: ActivationOfficeInfo;
  portalUser?: ActivationPortalUser;
};

export type LicenseCheckinResult = {
  ok: true;
  serverTime: number;
  nextCheckinDueAt: number;
  status: "ACTIVE" | "DISABLED";
  currentInviteCodeLast4?: string;
  currentPeriodEnd?: number | null;
  paymentRequired?: boolean;
  plan?: {
    clientSlots: number;
    tabletSlots: number;
  };
};

export type LicenseRequestError = {
  statusCode: number;
  code: string;
  message: string;
};

type PostJsonResult = {
  status: number;
  json: any;
  rawText?: string;
  networkError: LicenseRequestError | null;
};

const LICENSE_CLIENT_USER_AGENT = `OttoTracker/${process.env.OTTO_APP_VERSION || process.env.npm_package_version || "desktop"}`;

// Prefer Electron's net.fetch (Chromium's network stack) for portal requests.
// Node/undici presents a non-browser TLS/HTTP fingerprint that the portal's
// Cloudflare edge bot-management challenges — curl and the browser pass, but the
// app's undici request gets a non-JSON block page (REQUEST_FAILED) that never
// reaches the origin. net.fetch routes through Chromium, so the request is
// indistinguishable from the Chrome that already works. Falls back to global
// fetch outside Electron (dev/tests/non-Electron hosts).
let _licenseFetch: typeof fetch | null | undefined;
async function getLicenseFetch(): Promise<typeof fetch> {
  if (_licenseFetch === undefined) {
    _licenseFetch = null;
    try {
      if ((process as any)?.versions?.electron) {
        const mod = "electron"; // indirect so tsc/esbuild don't statically resolve it
        const electron: any = await import(mod);
        const netFetch = electron?.net?.fetch;
        if (typeof netFetch === "function") {
          _licenseFetch = ((input: any, init?: any) => netFetch.call(electron.net, input, init)) as typeof fetch;
        }
      }
    } catch {
      _licenseFetch = null; // not in an Electron main process — use global fetch
    }
  }
  return _licenseFetch || fetch;
}

export function getLicenseBaseUrl(): URL {
  const raw = (process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  try {
    return new URL(raw);
  } catch {
    return new URL("https://ottojobtracker.com");
  }
}

async function fetchJson(url: URL, body: unknown, bearerToken?: string): Promise<PostJsonResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // Identify the desktop so the response is unambiguous in logs and so the
        // portal's edge (e.g. Cloudflare bot rules) can allowlist by User-Agent.
        "User-Agent": LICENSE_CLIENT_USER_AGENT,
      };
      if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
      const doFetch = await getLicenseFetch();
      const res = await doFetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      // Read the raw body so non-JSON error responses (edge block pages, 5xx
      // HTML, etc.) are preserved for diagnostics instead of collapsing to null.
      const rawText = await res.text().catch(() => "");
      let json: any = null;
      if (rawText) { try { json = JSON.parse(rawText); } catch { json = null; } }
      return { status: res.status, json, rawText, networkError: null };
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      return {
        status: 0,
        json: null,
        networkError: {
          statusCode: 503,
          code: isTimeout ? "PORTAL_TIMEOUT" : "PORTAL_UNREACHABLE",
          message: isTimeout
            ? "Activation service timed out. Check internet access and try again."
            : "Could not reach the activation service. Check internet access and try again.",
        },
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function errorFromResponse(status: number, json: any, rawText?: string): LicenseRequestError {
  // For non-JSON error responses (edge block pages, 5xx HTML), surface the HTTP
  // status and a body snippet so lastError is diagnosable instead of a generic
  // "Request failed" that hides whether it was a 403/429/502/etc.
  const snippet = rawText ? rawText.replace(/\s+/g, " ").trim().slice(0, 180) : "";
  const message =
    (json && (json.error || json.message)) ||
    (status === 401
      ? "Unauthorized"
      : status === 404
        ? "Not found"
        : status === 409
          ? "Conflict"
          : `HTTP ${status}${snippet ? `: ${snippet}` : ""}`);
  const code =
    (json && (json.code || json.errorCode)) ||
    (status === 401
      ? "UNAUTHORIZED"
      : status === 404
        ? "NOT_FOUND"
        : status === 409
          ? "HOST_ALREADY_ACTIVATED"
          : "REQUEST_FAILED");
  return { statusCode: status, code: String(code), message: String(message) };
}

function parseActivationPayload(
  json: any,
  badResponseMessage: string,
): LicenseActivateResult | { ok: false; error: LicenseRequestError } {
  const hostToken = typeof json?.hostToken === "string" ? json.hostToken : "";
  const serverTime = typeof json?.serverTime === "number" ? json.serverTime : 0;
  const nextCheckinDueAt = typeof json?.nextCheckinDueAt === "number" ? json.nextCheckinDueAt : 0;
  const officeStatus = json?.status === "DISABLED" ? "DISABLED" : "ACTIVE";

  if (!hostToken || !serverTime || !nextCheckinDueAt) {
    return {
      ok: false,
      error: {
        statusCode: 502,
        code: "BAD_PORTAL_RESPONSE",
        message: badResponseMessage,
      },
    };
  }

  const result: LicenseActivateResult = {
    ok: true,
    hostToken,
    serverTime,
    nextCheckinDueAt,
    status: officeStatus,
  };

  const officeData = json?.office;
  if (officeData && typeof officeData === "object") {
    result.office = {
      name: typeof officeData.name === "string" ? officeData.name : undefined,
      address: typeof officeData.address === "string" ? officeData.address : undefined,
      phone: typeof officeData.phone === "string" ? officeData.phone : undefined,
      email: typeof officeData.email === "string" ? officeData.email : undefined,
      portalOfficeId: typeof officeData.portalOfficeId === "string" ? officeData.portalOfficeId : undefined,
    };
  }

  const userData = json?.portalUser;
  if (userData && typeof userData === "object") {
    result.portalUser = {
      firstName: typeof userData.firstName === "string" ? userData.firstName : undefined,
      lastName: typeof userData.lastName === "string" ? userData.lastName : undefined,
      email: typeof userData.email === "string" ? userData.email : undefined,
    };
  }

  return result;
}

export async function portalActivate(payload: {
  portalToken: string;
  officeId: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
  idempotencyKey?: string;
  forceReplace?: boolean;
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/portal/api/desktop/activate", base);
  const { portalToken, ...body } = payload;
  const { status, json, networkError } = await fetchJson(url, body, portalToken);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return parseActivationPayload(json, "Activation response was missing required fields.");
}

/** @deprecated Use portalActivate() instead — kept for backward compatibility. */
export async function portalIssueAndConsume(payload: {
  portalToken: string;
  officeId: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
  idempotencyKey?: string;
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/portal/api/desktop/claims/issue-and-consume", base);
  const { portalToken, ...body } = payload;
  const { status, json, networkError } = await fetchJson(url, body, portalToken);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return parseActivationPayload(json, "Issue-and-consume response was missing required fields.");
}

export type DailyActivitySummary = {
  date: string;
  actions: Record<string, number>;
  activeUsers: number;
  sessions: number;
};

export type RawUsageEvent = {
  userIdHash: string;
  eventType: string;
  metadata: Record<string, any>;
  occurredAt: number;
};

export type CheckinMetrics = {
  activeJobs?: number;
  archivedJobs?: number;
  totalUsers?: number;
  clientCount?: number;
  tabletCount?: number;
  platform?: string;
  // Capacity signals for the two attachment categories on disk. Row
  // counts only — no PHI leaves the box.
  orderSheetImports?: number;
  jobAttachments?: number;
  dailyActivity?: DailyActivitySummary[];
  rawEvents?: RawUsageEvent[];
};

export async function portalCheckin(payload: {
  hostToken: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
  localAddresses?: string[];
  pairingCode?: string;
  tlsFingerprint256?: string;
  metrics?: CheckinMetrics;
}): Promise<LicenseCheckinResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/checkin", base);
  const { status, json, rawText, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json, rawText) };

  const serverTime = typeof json?.serverTime === "number" ? json.serverTime : 0;
  const nextCheckinDueAt = typeof json?.nextCheckinDueAt === "number" ? json.nextCheckinDueAt : 0;
  const officeStatus = json?.status === "DISABLED" ? "DISABLED" : "ACTIVE";

  if (!serverTime || !nextCheckinDueAt) {
    return {
      ok: false,
      error: {
        statusCode: 502,
        code: "BAD_PORTAL_RESPONSE",
        message: "Check-in server response was missing required fields.",
      },
    };
  }

  const result: LicenseCheckinResult = {
    ok: true,
    serverTime,
    nextCheckinDueAt,
    status: officeStatus,
    currentInviteCodeLast4: typeof json?.currentInviteCodeLast4 === "string" ? json.currentInviteCodeLast4 : undefined,
    currentPeriodEnd: typeof json?.currentPeriodEnd === "number" ? json.currentPeriodEnd : null,
    paymentRequired: typeof json?.paymentRequired === "boolean" ? json.paymentRequired : undefined,
  };

  // Parse plan field if present (backward compat: older portals may not send this)
  const plan = json?.plan;
  if (plan && typeof plan === "object") {
    // New seat-based fields
    if (typeof plan.clientSlots === "number") {
      result.plan = {
        clientSlots: plan.clientSlots,
        tabletSlots: typeof plan.tabletSlots === "number" ? plan.tabletSlots : 0,
      };
    } else if (plan.tier === "core" || plan.tier === "pro") {
      // Backward compat: older portals send tier/maxClients/tabletAddonEnabled
      const maxClients = typeof plan.maxClients === "number" ? plan.maxClients : (plan.tier === "core" ? 2 : 999);
      result.plan = {
        clientSlots: maxClients === -1 ? 999 : maxClients,
        tabletSlots: Boolean(plan.tabletAddonEnabled) ? 999 : 0,
      };
    }
  }

  return result;
}

export type InviteCodeValidationResult =
  | { ok: true; officeName: string; officeId: string }
  | { ok: false; error: LicenseRequestError };

export async function portalValidateInviteCode(payload: {
  inviteCode: string;
  installationId: string;
}): Promise<InviteCodeValidationResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/portal/api/invite-codes/validate", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };

  if (status < 200 || status >= 300) {
    return { ok: false, error: errorFromResponse(status, json) };
  }

  if (!json?.valid) {
    return {
      ok: false,
      error: {
        statusCode: 403,
        code: "INVALID_INVITE_CODE",
        message: json?.message || "Invalid or expired invite code",
      },
    };
  }

  return {
    ok: true,
    officeName: String(json.officeName || ""),
    officeId: String(json.officeId || ""),
  };
}

// --- Invite code management (Host-side, requires hostToken) ---

export type InviteCodeInfo =
  | { ok: true; inviteCode: string; expiresAt?: number }
  | { ok: false; error: LicenseRequestError };

export async function portalGetInviteCode(payload: {
  hostToken: string;
}): Promise<InviteCodeInfo> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/invite-code", base);
  const { status, json, networkError } = await fetchJson(url, { hostToken: payload.hostToken });
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };

  return {
    ok: true,
    inviteCode: String(json?.inviteCode || ""),
    expiresAt: typeof json?.expiresAt === "number" ? json.expiresAt : undefined,
  };
}

export async function portalRegenerateInviteCode(payload: {
  hostToken: string;
}): Promise<InviteCodeInfo> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/invite-code/regenerate", base);
  const { status, json, networkError } = await fetchJson(url, { hostToken: payload.hostToken });
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };

  return {
    ok: true,
    inviteCode: String(json?.inviteCode || ""),
    expiresAt: typeof json?.expiresAt === "number" ? json.expiresAt : undefined,
  };
}

// --- Portal desktop auth (email/password → token + offices) ---

export type PortalOfficeEntry = {
  officeId: string;
  officeName: string;
  role: string;
  address?: string;
  phone?: string;
  email?: string;
  subscriptionStatus?: string;
};

export type PortalDesktopAuthResult =
  | {
      ok: true;
      token: string;
      expiresAt: number;
      offices: PortalOfficeEntry[];
      firstName?: string;
      lastName?: string;
      email?: string;
    }
  | { ok: false; error: LicenseRequestError };

export async function portalDesktopAuth(payload: {
  email: string;
  password: string;
}): Promise<PortalDesktopAuthResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/portal/api/auth/desktop-token", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };

  if (status === 401) {
    return {
      ok: false,
      error: { statusCode: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
    };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, error: errorFromResponse(status, json) };
  }

  const token = typeof json?.token === "string" ? json.token : "";
  if (!token) {
    return {
      ok: false,
      error: { statusCode: 502, code: "BAD_PORTAL_RESPONSE", message: "Portal did not return an authentication token." },
    };
  }

  // User data is nested under json.user in the portal response
  const user = json?.user && typeof json.user === "object" ? json.user : null;

  const offices: PortalOfficeEntry[] = Array.isArray(json?.offices)
    ? json.offices.map((o: any) => ({
        officeId: String(o?.officeId || o?.portalOfficeId || o?.id || ""),
        officeName: String(o?.officeName || o?.name || ""),
        role: String(o?.role || ""),
        address: typeof o?.address === "string" ? o.address : undefined,
        phone: typeof o?.phone === "string" ? o.phone : undefined,
        email: typeof o?.email === "string" ? o.email : undefined,
        subscriptionStatus: typeof o?.subscriptionStatus === "string" ? o.subscriptionStatus : undefined,
      }))
    : [];

  return {
    ok: true,
    token,
    expiresAt: typeof json?.expiresAt === "number" ? json.expiresAt : 0,
    offices,
    firstName: typeof user?.firstName === "string" ? user.firstName : undefined,
    lastName: typeof user?.lastName === "string" ? user.lastName : undefined,
    email: typeof user?.email === "string" ? user.email : undefined,
  };
}

// --- Feedback submission ---

export type FeedbackResult =
  | { ok: true }
  | { ok: false; error: LicenseRequestError };

export async function portalSubmitFeedback(payload: {
  hostToken: string;
  category: string;
  message: string;
  appVersion?: string;
  platform?: string;
}): Promise<FeedbackResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/feedback", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true };
}

// --- Patient tracking links (host-token authenticated) ---
//
// PHI guarantee — what we send to otto-web for tracking links is now
// strictly minimal. The portal stores opaque tokens, lifecycle, an
// append-only (status enum, occurred_at) event log, and opaque job
// UUIDs for coverage. Nothing else.
//
//   ✅ SENT
//     - hostToken (random secret, not patient data)
//     - jobIds[] (opaque desktop UUIDs — no PHI recoverable)
//     - status — canonical enum value, mapped from internal status
//       on the desktop before send. Unmappable statuses are DROPPED
//       on the desktop and never reach the portal.
//     - occurredAt / expiresAt — ISO timestamps
//
//   ❌ NEVER SENT
//     - patientFirstName / patientLastName / patientFirstInitial
//     - phone / trayNumber / orderId / internal notes /
//       customColumnValues
//     - office name / address / phone / email / user names
//     - jobType, status labels, status colors, custom-status mapping,
//       per-link visibility, ETA, custom notes / patient-facing notes,
//       link view counts, history of out-of-enum statuses

import { PATIENT_STATUS_VALUES, type PatientStatus } from "@shared/patient-status-enum";

/**
 * The DTO the desktop UI binds to. Most fields are vestigial now (the
 * portal returns empty arrays / nulls), kept so existing components
 * compile without forced churn. Notes are sourced from local SQLite
 * via the desktop's `/api/tracking-links/:id/notes` GET, not from the
 * portal — see active-tracking-link-panel.tsx.
 */
export interface TrackingLinkRecord {
  id: string;
  token: string;
  url: string;
  jobIds: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TrackingLinkResult =
  | { ok: true; link: TrackingLinkRecord }
  | { ok: false; error: LicenseRequestError };

export type TrackingLinkListResult =
  | { ok: true; links: TrackingLinkRecord[] }
  | { ok: false; error: LicenseRequestError };

function parseTrackingLink(json: any): TrackingLinkRecord | null {
  if (!json || typeof json !== "object") return null;
  if (typeof json.id !== "string" || typeof json.token !== "string") return null;
  return {
    id: json.id,
    token: json.token,
    url: typeof json.url === "string" ? json.url : "",
    jobIds: Array.isArray(json.jobIds) ? json.jobIds.map((s: any) => String(s)) : [],
    expiresAt: typeof json.expiresAt === "string" ? json.expiresAt : null,
    revokedAt: typeof json.revokedAt === "string" ? json.revokedAt : null,
    createdAt: typeof json.createdAt === "string" ? json.createdAt : new Date(0).toISOString(),
    updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : new Date(0).toISOString(),
  };
}

export async function portalCreateTrackingLink(payload: {
  hostToken: string;
  jobIds: string[];
  expiresAt?: string | null;
  // Optional initial event — the desktop posts the very first status
  // mapping so the patient page renders something on first visit.
  initialStatus?: PatientStatus;
  initialStatusAt?: string;
}): Promise<TrackingLinkResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const link = parseTrackingLink(json);
  if (!link) {
    return { ok: false, error: { statusCode: 502, code: "BAD_PORTAL_RESPONSE", message: "Tracking link response was malformed." } };
  }
  return { ok: true, link };
}

// --- Spotlight feature flags (host-token authenticated) ---
//
// The portal is opt-out: it returns the ids of spotlights to SUPPRESS
// (kill-switch). The desktop's local registry is the source of truth
// for what spotlights exist; we just subtract anything the portal flags
// as disabled. Empty list = nothing suppressed.

export type FeatureFlagsResult =
  | { ok: true; disabledFeatureIds: string[] }
  | { ok: false; error: LicenseRequestError };

export async function portalGetFeatureFlags(payload: {
  hostToken: string;
}): Promise<FeatureFlagsResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/feature-flags", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const ids = Array.isArray(json?.disabledFeatureIds)
    ? json.disabledFeatureIds.filter((s: any) => typeof s === "string")
    : [];
  return { ok: true, disabledFeatureIds: ids };
}

/**
 * Append a (status enum, occurredAt) event scoped to a jobId. The portal
 * resolves which active office links cover the jobId and appends to
 * each. Idempotent on (link, status, occurredAt).
 *
 * The status MUST already be a canonical enum value. Callers should
 * use shared/patient-status-enum.ts → mapStatusToEnum() and skip
 * sending when it returns null.
 */
/**
 * Read the office's per-status label-set choice from the portal. Returns
 * a map of status → index; missing keys mean "canonical (0)". The desktop
 * caches this for settings UI seeding and for previewing the patient
 * label in the office's chosen synonym.
 */
export async function portalGetTrackingLabelChoices(payload: {
  hostToken: string;
}): Promise<{ ok: true; choices: Record<string, number> } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/label-choices", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const choices: Record<string, number> = {};
  if (json && typeof json.choices === "object" && json.choices !== null) {
    for (const [k, v] of Object.entries(json.choices)) {
      if (typeof v === "number" && Number.isInteger(v)) choices[k] = v;
    }
  }
  return { ok: true, choices };
}

/**
 * Persist the office's per-status label-set choice on the portal. The
 * portal validates indices against the synonym list and silently drops
 * any out-of-range entries — desktop UI should never offer them.
 */
export async function portalUpdateTrackingLabelChoices(payload: {
  hostToken: string;
  choices: Record<string, number>;
}): Promise<{ ok: true; choices: Record<string, number> } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/label-choices", base);
  const { status, json, networkError } = await patchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const choices: Record<string, number> = {};
  if (json && typeof json.choices === "object" && json.choices !== null) {
    for (const [k, v] of Object.entries(json.choices)) {
      if (typeof v === "number" && Number.isInteger(v)) choices[k] = v;
    }
  }
  return { ok: true, choices };
}

// --- Client recovery tokens ---
//
// A long-lived opaque token issued by the Host (via the portal) to
// each Client computer at pairing time. The Client stores it locally
// and uses it to look up its office's CURRENT Host discovery info
// from the portal when its stored hostUrl/fingerprint goes stale
// (typically after a Replace Host flow on a different machine).
//
// Three flows in the desktop server:
//   - Host calls `portalIssueClientRecovery` during pairing, then
//     forwards the plaintext token back to the new Client.
//   - Client calls `portalLookupClientRecovery` (no host-token,
//     recovery token IS the credential) when reconnecting fails N
//     times in a row.
//   - Host calls `portalRevokeClientRecovery` when an admin removes
//     a device from the worklist, or when the Client itself signals
//     "uninstall and remove from account".

export interface ClientRecoveryDiscovery {
  hostUrl: string | null;
  fingerprint256: string | null;
  pairingCode: string | null;
  hostReplacementPending: boolean;
  updatedAt: string | null;
}

export async function portalIssueClientRecovery(payload: {
  hostToken: string;
  label?: string;
}): Promise<
  | { ok: true; recoveryId: string; recoveryToken: string }
  | { ok: false; error: LicenseRequestError }
> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/client-recovery/issue", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  if (typeof json?.recoveryId !== "string" || typeof json?.recoveryToken !== "string") {
    return { ok: false, error: { statusCode: 502, code: "BAD_PORTAL_RESPONSE", message: "Recovery issue response was malformed." } };
  }
  return { ok: true, recoveryId: json.recoveryId, recoveryToken: json.recoveryToken };
}

export async function portalLookupClientRecovery(payload: {
  recoveryToken: string;
}): Promise<
  | { ok: true; discovery: ClientRecoveryDiscovery }
  | { ok: false; error: LicenseRequestError }
> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/client-recovery/lookup", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return {
    ok: true,
    discovery: {
      hostUrl: typeof json?.hostUrl === "string" ? json.hostUrl : null,
      fingerprint256: typeof json?.fingerprint256 === "string" ? json.fingerprint256 : null,
      pairingCode: typeof json?.pairingCode === "string" ? json.pairingCode : null,
      hostReplacementPending: !!json?.hostReplacementPending,
      updatedAt: typeof json?.updatedAt === "string" ? json.updatedAt : null,
    },
  };
}

export async function portalRevokeClientRecovery(payload: {
  hostToken: string;
  recoveryId: string;
}): Promise<{ ok: true } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/client-recovery/revoke", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true };
}

export async function portalAppendTrackingEvent(payload: {
  hostToken: string;
  status: PatientStatus;
  occurredAt: string;
  // Either linkId (targeted) or jobId (fan out to all covering links).
  // Prefer linkId so per-link visibility gating works.
  linkId?: string;
  jobId?: string;
}): Promise<{ ok: true; updatedLinks: number } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/events", base);
  if (!(PATIENT_STATUS_VALUES as readonly string[]).includes(payload.status)) {
    return { ok: false, error: { statusCode: 400, code: "INVALID_STATUS", message: "status must be a canonical enum value" } };
  }
  if (!payload.linkId && !payload.jobId) {
    return { ok: false, error: { statusCode: 400, code: "MISSING_TARGET", message: "linkId or jobId required" } };
  }
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true, updatedLinks: typeof json?.updatedLinks === "number" ? json.updatedLinks : 0 };
}

async function patchJson(url: URL, body: unknown): Promise<PostJsonResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const doFetch = await getLicenseFetch();
    const res = await doFetch(url.toString(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "User-Agent": LICENSE_CLIENT_USER_AGENT },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, networkError: null };
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      status: 0,
      json: null,
      networkError: {
        statusCode: 503,
        code: isTimeout ? "PORTAL_TIMEOUT" : "PORTAL_UNREACHABLE",
        message: isTimeout
          ? "Tracking service timed out. Check internet access and try again."
          : "Could not reach the tracking service. Check internet access and try again.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function portalUpdateTrackingLink(payload: {
  hostToken: string;
  id: string;
  jobIds?: string[];
  expiresAt?: string | null;
}): Promise<TrackingLinkResult> {
  const base = getLicenseBaseUrl();
  const url = new URL(`/license/v1/tracking-links/${encodeURIComponent(payload.id)}`, base);
  const { id, ...body } = payload;
  const { status, json, networkError } = await patchJson(url, body);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const link = parseTrackingLink(json);
  if (!link) {
    return { ok: false, error: { statusCode: 502, code: "BAD_PORTAL_RESPONSE", message: "Tracking link response was malformed." } };
  }
  return { ok: true, link };
}

export async function portalRevokeTrackingLink(payload: {
  hostToken: string;
  id: string;
}): Promise<{ ok: true } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL(`/license/v1/tracking-links/${encodeURIComponent(payload.id)}/revoke`, base);
  const { status, json, networkError } = await fetchJson(url, { hostToken: payload.hostToken });
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true };
}

export async function portalListTrackingLinks(payload: {
  hostToken: string;
  jobIds: string[];
}): Promise<TrackingLinkListResult> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/list", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  const arr = Array.isArray(json?.links) ? json.links : [];
  const links = arr.map(parseTrackingLink).filter((l: TrackingLinkRecord | null): l is TrackingLinkRecord => Boolean(l));
  return { ok: true, links };
}
