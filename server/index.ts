import "./local-env";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import { enforceAirgap } from "./airgap";
import { logAudit } from "./audit-logger";
import { getLicenseSnapshot, startLicenseScheduler, onLicenseStateChange } from "./license";
import { broadcastToOffice, setupSyncWebSocket } from "./sync-websocket";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logError } from "./error-logger";
import { OTTO_DEFAULT_PORT } from "@shared/constants";

// ── PHI scrubbing helpers ──
// Ensures no Protected Health Information leaves the device via Sentry.
const PHI_KEY_PATTERNS = [
  /patient/i, /first.?name/i, /last.?name/i, /phone/i, /email/i,
  /address/i, /notes/i, /tray.?number/i, /login.?id/i, /pin/i,
  /password/i, /secret/i, /token/i, /ssn/i, /dob|date.?of.?birth/i,
  /insurance/i, /diagnosis/i, /prescription/i, /medical/i, /health/i,
  /content/i, /message/i, /user.?agent/i, /ip.?address/i,
  /requested.?by.?ip/i, /request.?message/i, /custom.?column/i,
];

function scrubPhi(obj: any, depth = 0): any {
  if (depth > 8 || obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map((v: any) => scrubPhi(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PHI_KEY_PATTERNS.some((p) => p.test(key))) {
      cleaned[key] = "[Redacted]";
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = scrubPhi(value, depth + 1);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function redactFreeText(text: string): string {
  if (typeof text !== "string") return text;
  for (const pattern of PHI_KEY_PATTERNS) {
    const src = pattern.source;
    text = text.replace(new RegExp(`("${src}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"), '$1"[Redacted]"');
    text = text.replace(new RegExp(`(${src}\\s*[:=]\\s*)\\S[^,}\\]\\n]*`, "gi"), "$1[Redacted]");
  }
  return text;
}

function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) breadcrumb.data = scrubPhi(breadcrumb.data);
  if (breadcrumb.message) breadcrumb.message = redactFreeText(breadcrumb.message);
  return breadcrumb;
}

// Initialize Sentry for the Express server when running standalone (non-Electron).
// When embedded in Electron, the main process already initializes Sentry via
// @sentry/electron/main (which is built on @sentry/node), so we skip here to
// avoid double-init.
//
// HIPAA: All events are scrubbed of PHI before transmission.  Request bodies,
// breadcrumbs, contexts, extras, and error messages are recursively cleaned
// of any key matching PHI_KEY_PATTERNS.
if (!process.versions.electron && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.OTTO_APP_VERSION || process.env.npm_package_version || undefined,
    environment: process.env.NODE_ENV || "production",
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
        delete event.user.id;
      }
      if (event.request) {
        if (event.request.data) {
          event.request.data = typeof event.request.data === "string"
            ? redactFreeText(event.request.data) : scrubPhi(event.request.data);
        }
        if (event.request.query_string) event.request.query_string = { _: "[Redacted]" } as any;
        delete event.request.cookies;
      }
      if (event.contexts) event.contexts = scrubPhi(event.contexts);
      if (event.extra) event.extra = scrubPhi(event.extra);
      if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Sentry.Breadcrumb => b != null);
      if (event.message) event.message = redactFreeText(event.message);
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redactFreeText(ex.value);
        }
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });
}

const app = express();

enforceAirgap();
startLicenseScheduler();

// Enforce licensing: after grace period, the app becomes read-only.
// Cache the snapshot for 24 hours to avoid computing it on every single write.
let _licenseCache: { snapshot: ReturnType<typeof getLicenseSnapshot>; cachedAt: number } | null = null;
const LICENSE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

// Invalidate the license cache whenever state changes (e.g. after check-in or activation).
onLicenseStateChange(() => { _licenseCache = null; });

function getCachedLicenseSnapshot() {
  const now = Date.now();
  if (_licenseCache && now - _licenseCache.cachedAt < LICENSE_CACHE_TTL_MS) {
    return _licenseCache.snapshot;
  }
  const snapshot = getLicenseSnapshot();
  _licenseCache = { snapshot, cachedAt: now };
  return snapshot;
}

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

  const snapshot = getCachedLicenseSnapshot();
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

// ── Security headers (F-03) ──
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; " +
    "connect-src 'self' wss:; frame-ancestors 'none'; " +
    "form-action 'self'; base-uri 'self'; object-src 'none';"
  );
  next();
});

// ── CORS (F-12) — restrict to same-origin only ──
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const port = process.env.PORT || String(OTTO_DEFAULT_PORT);
    const allowed = [
      `https://127.0.0.1:${port}`,
      `https://localhost:${port}`,
    ];
    // Also allow the machine's own hostname/IP (Clients connect via LAN IP)
    const host = req.headers.host;
    if (host) allowed.push(`https://${host}`);

    if (allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }
  next();
});

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

// Write startup progress to the SAME startup.log that Electron's main process uses.
// IMPORTANT: Use already-imported modules (fs, path, os) instead of require().
// Vite compiles require() to __require which throws in ESM bundles, silently
// breaking all logging inside try/catch blocks — making server crashes invisible.
import fsStartup from "fs";
import pathStartup from "path";
import osStartup from "os";

function getStartupLogPath(): string {
  // Electron sets OTTO_STARTUP_LOG_PATH so the server writes to the same file.
  if (process.env.OTTO_STARTUP_LOG_PATH) return process.env.OTTO_STARTUP_LOG_PATH;
  const dataDir = process.env.OTTO_DATA_DIR || pathStartup.join(osStartup.homedir(), ".otto-job-tracker");
  return pathStartup.join(dataDir, "startup.log");
}

function logStartupProgress(msg: string) {
  console.log(`[server-init] ${msg}`);
  try {
    const logPath = getStartupLogPath();
    fsStartup.appendFileSync(logPath, `[${new Date().toISOString()}] [server-init] ${msg}\n`);
  } catch { /* best-effort */ }
}

(async () => {
  logStartupProgress("Registering routes...");
  let server: any;
  let sessionMiddleware: any;
  try {
    ({ server, sessionMiddleware } = await registerRoutes(app));
  } catch (routeErr: any) {
    logStartupProgress(`FATAL: registerRoutes failed: ${routeErr?.stack || routeErr?.message || routeErr}`);
    throw routeErr;
  }
  logStartupProgress("Routes registered");

  setupSyncWebSocket(server as any, sessionMiddleware);

  // Sentry Express error handler — captures route errors before our handler.
  Sentry.setupExpressErrorHandler(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("Unhandled error:", process.env.OTTO_DEBUG === "true" ? err : message);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn’t interfere with the other routes
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

  // When running embedded in Electron (via import()), process.exit() would
  // kill the entire Electron app.  Instead, log the error and let Electron’s
  // readiness probe time out gracefully so it can show a user-friendly dialog.
  server.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Otto Tracker can’t start because port ${port} is already being used by another app.\n` +
          `Fix: close the other app (or change PORT in your .env file) and try again.`,
      );
    } else {
      console.error("Server error:", process.env.OTTO_DEBUG === "true" ? err : err?.message);
    }

    // Only exit when running standalone (not embedded in Electron).
    if (!process.versions.electron) {
      process.exit(1);
    }
  });

  // Track open connections so we can force-close them on shutdown.
  // Without this, keep-alive connections and WebSockets hold the port
  // open after server.close(), causing EADDRINUSE on next launch.
  const openConnections = new Set<import("net").Socket>();
  server.on("connection", (socket) => {
    openConnections.add(socket);
    socket.on("close", () => openConnections.delete(socket));
  });

  // Expose the server instance and a force-shutdown helper so Electron's
  // before-quit handler can close the port immediately.
  (globalThis as any).__ottoServer = server;
  (globalThis as any).__ottoForceShutdown = () => {
    // Destroy all open connections so the port is freed immediately.
    for (const socket of openConnections) {
      try { socket.destroy(); } catch { /* ignore */ }
    }
    openConnections.clear();
    try { server.close(); } catch { /* ignore */ }
  };

  logStartupProgress(`Binding to ${host}:${port}...`);
  server.listen({
    port,
    host,
  }, () => {
    logStartupProgress(`Server listening on ${host}:${port}`);
    log(`serving on ${host}:${port}`);
    if (process.env.OTTO_ENABLE_BACKGROUND_JOBS !== "false") {
      void import("./background-jobs")
        .then(({ startBackgroundJobs }) => startBackgroundJobs())
        .catch((error) => {
          console.error("Failed to start background jobs:", process.env.OTTO_DEBUG === "true" ? error : error?.message);
        });
    }
  });
})().catch((err) => {
  const msg = `Server failed to start: ${err?.stack || err?.message || err}`;
  console.error(msg);
  logStartupProgress(`FATAL: ${msg}`);
  // When embedded in Electron, let the readiness probe handle the failure.
  if (!process.versions.electron) {
    process.exit(1);
  }
});
