import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../modules/auth/auth.crypto.js';
import type { AuthUser, UserRole } from '../modules/auth/auth.types.js';

declare global { namespace Express { interface Request { user?: AuthUser } } }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = verifyToken(header.slice(7)); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}
