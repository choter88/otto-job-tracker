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
  networkError: LicenseRequestError | null;
};

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
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
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
            ? "Activation service timed out. Check internet access and try again."
            : "Could not reach the activation service. Check internet access and try again.",
        },
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function errorFromResponse(status: number, json: any): LicenseRequestError {
  const message =
    (json && (json.error || json.message)) ||
    (status === 401
      ? "Unauthorized"
      : status === 404
        ? "Not found"
        : status === 409
          ? "Conflict"
          : "Request failed");
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
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };

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
// PHI guarantee — what we send to otto-web for tracking links:
//
//   ✅ SENT
//     - hostToken (random secret, not patient data)
//     - jobs[] snapshot — strictly { id, jobType, currentStatus,
//       statusChangedAt, history? }. Built by `buildJobSnapshots` in
//       routes.ts which never spreads the raw Job row.
//     - visibleStatuses[] — array of status IDs (e.g. "in_progress")
//     - statusCatalog[] — { id, label } from office.settings.customStatuses,
//       length-capped server-side. Lets the patient page render office-
//       custom status IDs sensibly. Office-defined labels — never patient
//       data.
//     - eta — ISO date for the order, not the patient
//     - customNotes — free text, scanned by `scanNotesForPhi` BEFORE this
//       is called. Rejected if it contains a phone, email, SSN, DOB, the
//       patient's first/last name, or "prescription"/"diagnosis".
//     - expiresAt — ISO date
//
//   ❌ NEVER SENT (anywhere in the tracking-link flow)
//     - patientFirstName / patientLastName / patientFirstInitial
//     - phone (patient phone)
//     - trayNumber, orderId, internal `notes`, customColumnValues
//     - office name / address / phone / email
//     - user names

export interface TrackingJobSnapshot {
  id: string;
  jobType: string;
  currentStatus: string;
  statusChangedAt: string;
  history?: Array<{ status: string; at: string }>;
}

export interface TrackingStatusCatalogEntry {
  id: string;
  label: string;
}

export interface TrackingLinkRecord {
  id: string;
  token: string;
  url: string;
  jobIds: string[];
  jobs: TrackingJobSnapshot[];
  visibleStatuses: string[];
  eta: string | null;
  customNotes: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TrackingLinkResult =
  | { ok: true; link: TrackingLinkRecord }
  | { ok: false; error: LicenseRequestError };

export type TrackingLinkListResult =
  | { ok: true; links: TrackingLinkRecord[] }
  | { ok: false; error: LicenseRequestError };

function parseTrackingJobs(raw: any): TrackingJobSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackingJobSnapshot[] = [];
  for (const j of raw) {
    if (!j || typeof j !== "object") continue;
    if (typeof j.id !== "string" || typeof j.jobType !== "string") continue;
    if (typeof j.currentStatus !== "string" || typeof j.statusChangedAt !== "string") continue;
    const history = Array.isArray(j.history)
      ? j.history
          .filter((h: any) => h && typeof h.status === "string" && typeof h.at === "string")
          .map((h: any) => ({ status: String(h.status), at: String(h.at) }))
      : undefined;
    out.push({
      id: j.id,
      jobType: j.jobType,
      currentStatus: j.currentStatus,
      statusChangedAt: j.statusChangedAt,
      history,
    });
  }
  return out;
}

function parseTrackingLink(json: any): TrackingLinkRecord | null {
  if (!json || typeof json !== "object") return null;
  if (typeof json.id !== "string" || typeof json.token !== "string") return null;
  return {
    id: json.id,
    token: json.token,
    url: typeof json.url === "string" ? json.url : "",
    jobIds: Array.isArray(json.jobIds) ? json.jobIds.map((s: any) => String(s)) : [],
    jobs: parseTrackingJobs(json.jobs),
    visibleStatuses: Array.isArray(json.visibleStatuses) ? json.visibleStatuses.map((s: any) => String(s)) : [],
    eta: typeof json.eta === "string" ? json.eta : null,
    customNotes: typeof json.customNotes === "string" ? json.customNotes : null,
    expiresAt: typeof json.expiresAt === "string" ? json.expiresAt : null,
    revokedAt: typeof json.revokedAt === "string" ? json.revokedAt : null,
    viewCount: typeof json.viewCount === "number" ? json.viewCount : 0,
    lastViewedAt: typeof json.lastViewedAt === "string" ? json.lastViewedAt : null,
    createdAt: typeof json.createdAt === "string" ? json.createdAt : new Date(0).toISOString(),
    updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : new Date(0).toISOString(),
  };
}

export async function portalCreateTrackingLink(payload: {
  hostToken: string;
  jobs: TrackingJobSnapshot[];
  visibleStatuses?: string[];
  statusCatalog?: TrackingStatusCatalogEntry[];
  eta?: string | null;
  customNotes?: string | null;
  expiresAt?: string | null;
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

export async function portalRefreshTrackingCatalog(payload: {
  hostToken: string;
  statusCatalog: TrackingStatusCatalogEntry[];
}): Promise<{ ok: true } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/refresh-catalog", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true };
}

export async function portalSyncTrackingJob(payload: {
  hostToken: string;
  jobId: string;
  jobType?: string;
  currentStatus: string;
  statusChangedAt: string;
  appendHistory?: { status: string; at: string };
  statusCatalog?: TrackingStatusCatalogEntry[];
}): Promise<{ ok: true; updatedLinks: number } | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/tracking-links/sync-job", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return { ok: true, updatedLinks: typeof json?.updatedLinks === "number" ? json.updatedLinks : 0 };
}

async function patchJson(url: URL, body: unknown): Promise<PostJsonResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
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
  jobs?: TrackingJobSnapshot[];
  visibleStatuses?: string[];
  statusCatalog?: TrackingStatusCatalogEntry[];
  eta?: string | null;
  customNotes?: string | null;
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
