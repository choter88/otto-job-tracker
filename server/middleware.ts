import { Request, Response, NextFunction } from 'express';

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
