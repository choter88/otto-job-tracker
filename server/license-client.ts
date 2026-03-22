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

function getLicenseBaseUrl(): URL {
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

export async function portalCheckin(payload: {
  hostToken: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
  localAddresses?: string[];
  pairingCode?: string;
  tlsFingerprint256?: string;
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

  return {
    ok: true,
    serverTime,
    nextCheckinDueAt,
    status: officeStatus,
    currentInviteCodeLast4: typeof json?.currentInviteCodeLast4 === "string" ? json.currentInviteCodeLast4 : undefined,
    currentPeriodEnd: typeof json?.currentPeriodEnd === "number" ? json.currentPeriodEnd : null,
  };
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
