import net from "net";

// Parse a target URL into { host, port } for a raw TCP reachability probe.
// Returns null when the URL can't be parsed or has no host. Pure + testable
// (the actual probe below is not, since it touches the network).
export function parseHostPort(targetUrl) {
  try {
    const u = new URL(targetUrl);
    const host = u.hostname;
    if (!host) return null;
    const port = u.port
      ? Number(u.port)
      : u.protocol === "https:" || u.protocol === "wss:"
        ? 443
        : 80;
    if (!Number.isInteger(port) || port <= 0) return null;
    return { host, port };
  } catch {
    return null;
  }
}

// Resolve true if a raw TCP connection to host:port succeeds within timeoutMs.
// Runs in the MAIN process so it is independent of the (possibly wedged)
// renderer/webContents — that independence is the whole point: it tells us the
// host is actually back even when an in-window reload can't recover.
export function probeHost({ host, port, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, sock) => {
      if (settled) return;
      settled = true;
      try { sock?.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    try {
      const sock = net.connect({ host, port });
      sock.setTimeout(timeoutMs);
      sock.once("connect", () => finish(true, sock));
      sock.once("timeout", () => finish(false, sock));
      sock.once("error", () => finish(false, sock));
    } catch {
      resolve(false);
    }
  });
}
