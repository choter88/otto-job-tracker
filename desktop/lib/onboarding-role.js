/**
 * Pure decision logic for the portal-login onboarding flow. No Electron, no
 * network — so it is unit-testable with node:test. The renderer (setup.html)
 * and main-process wiring stay thin on top of this.
 */

// lastCheckinAt may arrive as epoch ms (number) or an ISO string (Drizzle
// timestamp serialized to JSON). Normalize to epoch ms; 0 means "unknown".
function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// localAddresses arrive from the portal as SCHEME-LESS "host:port" strings (the
// edge WAF 403-blocks any body containing scheme://IP:port). Re-add the scheme
// here, never on the wire. Returns a full URL with no trailing slash, or null.
export function addressToUrl(addr, scheme = "https") {
  const raw = String(addr || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(`${scheme}://${raw}`);
    if (!u.hostname) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// Decide which role to preselect for ONE office from its portal host record.
//   no host yet              -> "host"   (this is the first computer)
//   host checked in recently -> "client" (a host already serves this office)
//   host record stale / no office -> "manual" (fail closed: user picks)
// now/staleMs are injected so this stays pure. When they're omitted, a present
// host is treated as "client" (no staleness opinion).
export function decidePreselectedRole(office, { now, staleMs } = {}) {
  if (!office || typeof office !== "object") {
    return { role: "manual", reason: "no-office" };
  }
  const host = office.host;
  const addrs = host && Array.isArray(host.localAddresses) ? host.localAddresses : [];
  if (!host || addrs.length === 0) {
    return { role: "host", reason: "no-host" };
  }
  const last = toEpochMs(host.lastCheckinAt);
  if (Number.isFinite(staleMs) && Number.isFinite(now) && last > 0 && now - last > staleMs) {
    return { role: "manual", reason: "host-stale", host };
  }
  return { role: "client", reason: "host-present", host };
}

// Probe the office's published addresses and return the first reachable host
// URL (full, scheme-qualified), or null if none answer. `probe` is injected:
// ({host, port}) => Promise<boolean>. Sequential by design — the first reachable
// address wins and we stop; a host's NIC list is short.
export async function pickReachableHostUrl(localAddresses, { probe, scheme = "https" } = {}) {
  const list = Array.isArray(localAddresses) ? localAddresses : [];
  for (const addr of list) {
    const url = addressToUrl(addr, scheme);
    if (!url) continue;
    let hp;
    try {
      const u = new URL(url);
      hp = { host: u.hostname, port: Number(u.port) || (scheme === "https" ? 443 : 80) };
    } catch {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- intentional: stop at first reachable
    const ok = await probe(hp);
    if (ok) return url;
  }
  return null;
}
