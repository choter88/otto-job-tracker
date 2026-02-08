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

function getLicenseBaseUrl(): URL {
  const raw = (process.env.OTTO_LICENSE_BASE_URL || "https://ottojobtracker.com").trim();
  try {
    return new URL(raw);
  } catch {
    return new URL("https://ottojobtracker.com");
  }
}

async function fetchJson(url: URL, body: unknown): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function errorFromResponse(status: number, json: any): LicenseRequestError {
  const message =
    (json && (json.error || json.message)) ||
    (status === 401 ? "Unauthorized" : status === 409 ? "Conflict" : "Request failed");
  const code =
    (json && (json.code || json.errorCode)) ||
    (status === 401 ? "UNAUTHORIZED" : status === 409 ? "HOST_ALREADY_ACTIVATED" : "REQUEST_FAILED");
  return { statusCode: status, code: String(code), message: String(message) };
}

export async function portalActivate(payload: {
  activationCode: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
}): Promise<LicenseActivateResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/activate", base);
  const { status, json } = await fetchJson(url, payload);
  if (status < 200 || status >= 300) return { ok: false, error: errorFromResponse(status, json) };

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
        message: "Activation server response was missing required fields.",
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

export async function portalCheckin(payload: {
  hostToken: string;
  installationId: string;
  hostFingerprint256: string;
  appVersion?: string;
}): Promise<LicenseCheckinResult | { ok: false; error: LicenseRequestError }> {
  const base = getLicenseBaseUrl();
  const url = new URL("/license/v1/checkin", base);
  const { status, json } = await fetchJson(url, payload);
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
