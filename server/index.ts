import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logError } from "./error-logger";
// NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
// import { setupWebSocket } from "./websocket";
// import { startBackgroundJobs } from "./background-jobs";

const app = express();

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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);

      // Log errors (4xx and 5xx) to persistent file
      if (res.statusCode >= 400) {
        const user = (req as any).user;
        logError({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: path,
          statusCode: res.statusCode,
          errorMessage: capturedJsonResponse?.message || capturedJsonResponse?.error || 'Unknown error',
          userId: user?.id,
          officeId: user?.officeId,
          requestBody: req.method !== 'GET' ? sanitizeBody(req.body) : undefined,
          duration,
        });
      }
    }
  });

  next();
});

// Sanitize request body to remove sensitive data before logging (deep redaction)
function sanitizeBody(body: any, depth = 0): any {
  if (!body || depth > 10) return undefined;
  if (typeof body !== 'object') return body;
  if (Array.isArray(body)) {
    return body.map(item => sanitizeBody(item, depth + 1));
  }
  
  const sensitiveKeys = ['password', 'token', 'secret', 'apikey', 'authorization', 'credentials', 'key'];
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(body)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

(async () => {
  const { server, sessionMiddleware: _sessionMiddleware } = await registerRoutes(app);
  
  // NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
  // setupWebSocket(server, sessionMiddleware);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    // NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
    // Background jobs (overdue detection, analytics) are disabled
    // startBackgroundJobs();
  });
})();
