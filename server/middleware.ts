import { Request, Response, NextFunction } from "express";

type UserRole = "owner" | "manager" | "staff" | "view_only" | "super_admin";

// ── Idempotency cache for offline outbox retries ──
// Prevents duplicate job creation when the Client queues a request,
// the server processes it, but the response is lost (network drop).
// On retry, the outbox sends the same Idempotency-Key header and gets
// the cached response instead of creating a duplicate.
const idempotencyCache = new Map<string, { status: number; body: string; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

// Prune expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (entry.expiresAt < now) idempotencyCache.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Middleware: checks Idempotency-Key header on mutating requests.
 * If the key was already processed, returns the cached response.
 * Otherwise, wraps res.json to capture and cache the response.
 */
export function idempotencyGuard(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return next();

  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  // Check cache
  const cached = idempotencyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.status(cached.status).setHeader("Content-Type", "application/json").end(cached.body);
    return;
  }

  // Wrap res.json to capture the response
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const status = res.statusCode || 200;
    try {
      const bodyStr = JSON.stringify(body);
      idempotencyCache.set(key, {
        status,
        body: bodyStr,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      });
    } catch { /* ignore serialization errors */ }
    return originalJson(body);
  };

  next();
}

function getUser(req: Request) {
  return req.user as (Express.User & { role?: UserRole; officeId?: string | null }) | undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  next();
}

export function requireOffice(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = getUser(req);
  const officeId = typeof user?.officeId === "string" ? user.officeId : "";
  if (!officeId) {
    return res.status(400).json({ error: "No office associated" });
  }

  next();
}

export function requireNotViewOnly(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = getUser(req);
  if (user?.role === "view_only") {
    return res.status(403).json({ error: "Read-only access" });
  }

  next();
}

export function requireRole(allowed: UserRole[]) {
  const allowSet = new Set<UserRole>(allowed);

  return function roleMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated?.() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = getUser(req);
    const role = user?.role;
    if (role === "super_admin") return next();
    if (!role || !allowSet.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

export function requireSameOfficeParam(paramName: string) {
  return function sameOfficeMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated?.() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = getUser(req);
    if (user?.role === "super_admin") return next();

    const officeId = typeof user?.officeId === "string" ? user.officeId : "";
    if (!officeId) {
      return res.status(400).json({ error: "No office associated" });
    }

    const paramValue = typeof (req.params as any)?.[paramName] === "string" ? String((req.params as any)[paramName]) : "";
    if (!paramValue || paramValue !== officeId) {
      return res.status(403).json({ error: "Access denied" });
    }

    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = req.user as any;
  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  next();
}
