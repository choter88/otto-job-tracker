import { Request, Response, NextFunction } from "express";

type UserRole = "owner" | "manager" | "staff" | "view_only" | "super_admin";

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
