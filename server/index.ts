import "./local-env";
import express, { type Request, Response, NextFunction } from "express";
import { enforceAirgap } from "./airgap";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logError } from "./error-logger";
// NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
// import { setupWebSocket } from "./websocket";
// import { startBackgroundJobs } from "./background-jobs";

const app = express();

enforceAirgap();

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
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
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
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);

      // Log errors (4xx and 5xx) to persistent file (no request/response payloads)
      if (res.statusCode >= 400) {
        const user = (req as any).user;
        logError({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: path,
          statusCode: res.statusCode,
          errorMessage: capturedErrorMessage || "Unknown error",
          userId: user?.id,
          officeId: user?.officeId,
          duration,
        });
      }
    }
  });

  next();
});

(async () => {
  const { server, sessionMiddleware: _sessionMiddleware } = await registerRoutes(app);
  
  // NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
  // setupWebSocket(server, sessionMiddleware);

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
  // Default to 5150 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5150', 10);
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
    // NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
    // Background jobs (overdue detection, analytics) are disabled
    // startBackgroundJobs();
  });
})();
