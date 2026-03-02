import http from "http";
import https from "https";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLocalHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost") return true;
  if (hostname === "::1") return true;
  if (hostname === "127.0.0.1") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && isPrivateIpv4(hostname)) return true;
  if (!hostname.includes(".")) return true;
  if (hostname.endsWith(".local")) return true;
  return false;
}

function hostnameFromRequestArgs(args: any[]): string | undefined {
  const first = args[0];
  if (!first) return undefined;

  if (typeof first === "string") {
    try {
      return new URL(first).hostname;
    } catch {
      return undefined;
    }
  }

  if (first instanceof URL) return first.hostname;
  if (typeof first === "object") return first.hostname || first.host;
  return undefined;
}

function isAllowedByAllowlist(hostname: string | undefined): boolean {
  const allowlist = (process.env.OTTO_EGRESS_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!hostname) return true;
  return allowlist.includes(hostname);
}

export function enforceAirgap(): void {
  if (process.env.OTTO_AIRGAP !== "true") return;

  const originalHttpRequest = http.request.bind(http);
  const originalHttpsRequest = https.request.bind(https);
  const originalFetch = globalThis.fetch?.bind(globalThis);

  function guardAndCall(original: any, args: any[]) {
    const hostname = hostnameFromRequestArgs(args);
    if (isAllowedByAllowlist(hostname)) {
      return original(...args);
    }

    if (!hostname || isLocalHostname(hostname)) {
      return original(...args);
    }

    throw new Error(`Outbound network blocked by OTTO_AIRGAP (hostname=${hostname})`);
  }

  (http as any).request = (...args: any[]) => guardAndCall(originalHttpRequest, args);
  (https as any).request = (...args: any[]) => guardAndCall(originalHttpsRequest, args);

  if (originalFetch) {
    globalThis.fetch = async (...args: any[]) => {
      const first = args[0];
      const hostname =
        typeof first === "string"
          ? (() => {
              try {
                return new URL(first).hostname;
              } catch {
                return undefined;
              }
            })()
          : first instanceof URL
            ? first.hostname
            : typeof first === "object" && first !== null
              ? (first as any).hostname || (first as any).host || (() => {
                  const url = (first as any).url;
                  if (typeof url !== "string") return undefined;
                  try {
                    return new URL(url).hostname;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;

      if (!isAllowedByAllowlist(hostname) && hostname && !isLocalHostname(hostname)) {
        throw new Error(`Outbound network blocked by OTTO_AIRGAP (hostname=${hostname})`);
      }

      return (originalFetch as any)(...args);
    };
  }
}
