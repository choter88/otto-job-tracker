export type LicenseActivateResult = {
  ok: true;
  hostToken: string;
  serverTime: number;
  nextCheckinDueAt: number;
  status: "ACTIVE" | "DISABLED";
};

export type LicenseCheckinResult = {
  ok: true;
  serverTime: number;
  nextCheckinDueAt: number;
  status: "ACTIVE" | "DISABLED";
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
  jsonInput: any,
  badResponseMessage: string,
): LicenseActivateResult | { ok: false; error: LicenseRequestError } {
  const json =
    jsonInput && typeof jsonInput === "object" && jsonInput.license && typeof jsonInput.license === "object"
      ? jsonInput.license
      : jsonInput;

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

  return {
    ok: true,
    hostToken,
    serverTime,
    nextCheckinDueAt,
    status: officeStatus,
  };
}

export async function portalActivate(payload: {
  activationCode: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/activate", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return parseActivationPayload(json, "Activation server response was missing required fields.");
}

function getClaimConsumePathCandidates(): string[] {
  const fromEnv = String(process.env.OTTO_PORTAL_CLAIM_CONSUME_PATH || "").trim();
  const defaults = ["/api/desktop/claims/consume", "/portal/api/desktop/claims/consume", "/license/v1/claim-host"];
  const candidates = [fromEnv, ...defaults].filter(Boolean);
  return Array.from(new Set(candidates));
}

export async function portalConsumeHostClaim(payload: {
  claimCode: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const candidates = getClaimConsumePathCandidates();
  if (candidates.length === 0) {
    return {
      ok: false,
      error: {
        statusCode: 500,
        code: "CLAIM_ENDPOINT_NOT_CONFIGURED",
        message: "Claim endpoint is not configured.",
      },
    };
  }

  let lastNotFoundError: LicenseRequestError | null = null;
  for (const path of candidates) {
    const url = new URL(path, base);
    const { status, json, networkError } = await fetchJson(url, payload);
    if (networkError) return { ok: false, error: networkError };

    if (status === 404) {
      lastNotFoundError = errorFromResponse(status, json);
      continue;
    }

    if (status < 200 || status >= 300) {
      return { ok: false, error: errorFromResponse(status, json) };
    }

    return parseActivationPayload(
      json,
      "Claim response was missing license activation fields (hostToken/serverTime/nextCheckinDueAt).",
    );
  }

  return {
    ok: false,
    error:
      lastNotFoundError ||
      {
        statusCode: 404,
        code: "CLAIM_ENDPOINT_NOT_FOUND",
        message: "Claim endpoint was not found on the portal service.",
      },
  };
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
  };
}

// --- Claim validation (non-destructive, returns office + user details) ---

export type ClaimValidationResult = {
  ok: true;
  office?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    portalOfficeId?: string;
  };
  portalUser?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

export async function portalValidateHostClaim(payload: {
  claimCode: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
}): Promise<ClaimValidationResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/api/desktop/claims/validate", base);
  const { status, json, networkError } = await fetchJson(url, payload);
  if (networkError) return { ok: false, error: networkError };

  if (status === 404) {
    return {
      ok: false,
      error: { statusCode: 404, code: "VALIDATE_NOT_SUPPORTED", message: "Portal does not support claim validation." },
    };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, error: errorFromResponse(status, json) };
  }

  const result: ClaimValidationResult = { ok: true };

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
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/portal/api/desktop/claims/issue-and-consume", base);
  const { portalToken, ...body } = payload;
  const { status, json, networkError } = await fetchJson(url, body, portalToken);
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };
  return parseActivationPayload(json, "Issue-and-consume response was missing required fields.");
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
  const url = new URL("/portal/api/invite-codes", base);
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
  const url = new URL("/portal/api/invite-codes/regenerate", base);
  const { status, json, networkError } = await fetchJson(url, { hostToken: payload.hostToken });
  if (networkError) return { ok: false, error: networkError };
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };

  return {
    ok: true,
    inviteCode: String(json?.inviteCode || ""),
    expiresAt: typeof json?.expiresAt === "number" ? json.expiresAt : undefined,
  };
}
