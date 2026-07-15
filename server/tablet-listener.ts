import type { IncomingMessage, ServerResponse } from "http";

// The cleartext tablet HTTP listener is off by default. Some iOS Safari
// deployments can't accept our self-signed HTTPS cert, so operators who
// need the plain-HTTP fallback must opt in explicitly.
export function tabletHttpEnabled(): boolean {
  return process.env.OTTO_TABLET_HTTP === "1";
}

// Wraps an Express `app` so the cleartext listener only ever serves
// /tablet/* routes. PHI, PIN login, and session routes must never be
// reachable over this unencrypted listener.
export function makeTabletOnlyHandler(
  app: (req: IncomingMessage, res: ServerResponse) => void,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "";
    if (url === "/tablet" || url.startsWith("/tablet/")) {
      app(req, res);
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "not found" }));
  };
}
