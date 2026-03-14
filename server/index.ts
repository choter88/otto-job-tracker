import "./local-env";
import express, { type Request, Response, NextFunction } from "express";
import { enforceAirgap } from "./airgap";
import { logAudit } from "./audit-logger";
import { getLicenseSnapshot, startLicenseScheduler } from "./license";
import { broadcastToOffice, setupSyncWebSocket } from "./sync-websocket";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logError } from "./error-logger";
import { OTTO_DEFAULT_PORT } from "@shared/constants";

const app = express();

enforceAirgap();
startLicenseScheduler();

// Enforce licensing: after grace period, the app becomes read-only.
app.use((req, res, next) => {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  if (!req.path.startsWith("/api")) return next();

  // Always allow authentication + licensing + initial bootstrap.
  const allowlist = new Set([
    "/api/login",
    "/api/logout",
    "/api/license/activate",
    "/api/license/checkin",
    "/api/invite-code/regenerate",
    "/api/setup/portal-auth",
    "/api/setup/bootstrap",
    "/api/setup/client-register",
    "/api/setup/import-snapshot",
  ]);
  if (allowlist.has(req.path)) return next();

  const snapshot = getLicenseSnapshot();
  if (snapshot.writeAllowed) return next();

  return res.status(403).json({
    error: snapshot.message,
    code: "READ_ONLY",
    license: snapshot,
  });
});

// LAN realtime sync: broadcast changes to other Clients.
app.use((req, res, next) => {
  const method = String(req.method || "GET").toUpperCase();
  const isMutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (!isMutating) return next();
  if (!req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/api/license")) return next();
  if (req.path === "/api/login" || req.path === "/api/logout") return next();
  if (req.path.startsWith("/api/setup")) return next();

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const officeId = (req as any).user?.officeId as string | undefined;
    if (!officeId) return;
    broadcastToOffice(officeId, { type: "office_updated", ts: Date.now() });
  });

  next();
});

function normalizeIp(ip: string): string {
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (normalized === "::1") return true;
  if (normalized === "127.0.0.1") return true;
  if (normalized === "0.0.0.0") return true;

  // IPv6: Unique local (fc00::/7) and link-local (fe80::/10)
  if (normalized.includes(":")) {
    const lower = normalized.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80:")) return true;
    return false;
  }

  const parts = normalized.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function normalizeAuditPath(requestPath: string): string {
  return (requestPath || "/")
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[a-f0-9]{24,}(?=\/|$)/gi, "/:id")
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:id");
}

function getRequestIp(req: Request): string {
  const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
  const forwardedFor = trustProxy
    ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    : undefined;

  const remote = forwardedFor || req.socket.remoteAddress || req.ip || "unknown";
  return normalizeIp(remote);
}

// Default: only allow office LAN access (prevents accidental exposure to the public internet)
app.use((req, res, next) => {
  if (process.env.OTTO_LAN_ONLY === "false") return next();

  const trustProxy = process.env.OTTO_TRUST_PROXY === "true";
  const forwardedFor = trustProxy
    ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    : undefined;

  const remote = forwardedFor || req.socket.remoteAddress || req.ip || "unknown";

  if (remote === "unknown" || !isPrivateIp(remote)) {
    return res.status(403).json({ error: "LAN only" });
  }

  next();
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: "50mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const method = String(req.method || "GET").toUpperCase();
  const path = req.path;
  let capturedErrorMessage: string | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (bodyJson && typeof bodyJson === "object") {
      const maybeMessage = (bodyJson as any).message ?? (bodyJson as any).error;
      if (typeof maybeMessage === "string") {
        capturedErrorMessage = maybeMessage.slice(0, 300);
      }
    }
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${method} ${path} ${res.statusCode} in ${duration}ms`;

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);

      // Log errors (4xx and 5xx) to persistent file (no request/response payloads)
      if (res.statusCode >= 400) {
        const user = (req as any).user;
        logError({
          timestamp: new Date().toISOString(),
          method,
          path: path,
          statusCode: res.statusCode,
          errorMessage: capturedErrorMessage || "Unknown error",
          userId: user?.id,
          officeId: user?.officeId,
          duration,
        });
      }

      const isMutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
      const isAccessFailure = res.statusCode === 401 || res.statusCode === 403;
      const isServerFailure = res.statusCode >= 500;
      if (isMutating || isAccessFailure || isServerFailure) {
        const user = req.user;
        logAudit({
          timestamp: new Date().toISOString(),
          method,
          path: normalizeAuditPath(path),
          statusCode: res.statusCode,
          durationMs: duration,
          outcome: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "denied" : "success",
          userId: typeof user?.id === "string" ? user.id : undefined,
          officeId: typeof user?.officeId === "string" ? user.officeId : undefined,
          role: typeof user?.role === "string" ? user.role : undefined,
          ipAddress: getRequestIp(req),
          userAgent:
            res.statusCode >= 400 && typeof req.headers["user-agent"] === "string"
              ? req.headers["user-agent"]
              : undefined,
        });
      }
    }
  });

  next();
});

(async () => {
  const { server, sessionMiddleware } = await registerRoutes(app);
  
  setupSyncWebSocket(server as any, sessionMiddleware);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("Unhandled error:", process.env.OTTO_DEBUG === "true" ? err : message);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Default to OTTO_DEFAULT_PORT if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || String(OTTO_DEFAULT_PORT), 10);
  const host = process.env.OTTO_LISTEN_HOST || "0.0.0.0";

  server.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Otto Tracker can’t start because port ${port} is already being used by another app.\n` +
          `Fix: close the other app (or change PORT in your .env file) and try again.`,
      );
      process.exit(1);
    }

    console.error("Server error:", process.env.OTTO_DEBUG === "true" ? err : err?.message);
    process.exit(1);
  });

  server.listen({
    port,
    host,
  }, () => {
    log(`serving on ${host}:${port}`);
    if (process.env.OTTO_ENABLE_BACKGROUND_JOBS !== "false") {
      void import("./background-jobs")
        .then(({ startBackgroundJobs }) => startBackgroundJobs())
        .catch((error) => {
          console.error("Failed to start background jobs:", process.env.OTTO_DEBUG === "true" ? error : error?.message);
        });
    }
  });
})();
