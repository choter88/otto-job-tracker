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

async function fetchJson(url: URL, body: unknown): Promise<PostJsonResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    try {
      const res = await fetch(url, {
        method: "POST",
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
