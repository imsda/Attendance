import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db.js';
import { allowedPagesFor, credentialStamp } from '../services/access.js';

function unauthorized(req: Request, res: Response) {
  req.session.destroy(() => res.status(401).json({ error: 'Unauthorized' }));
}

// Re-reads the signed-in user on every request so deleted users, role changes,
// and password resets take effect immediately instead of at session expiry.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.adminUserId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await prisma.adminUser.findUnique({
    where: { id: req.session.adminUserId },
    select: { role: true, passwordHash: true, pageAccess: { select: { page: true } } }
  });
  if (!user) return unauthorized(req, res);
  const stamp = credentialStamp(user.passwordHash);
  if (!req.session.credentialStamp) req.session.credentialStamp = stamp;
  else if (req.session.credentialStamp !== stamp) return unauthorized(req, res);
  req.session.role = user.role;
  req.session.allowedPages = allowedPagesFor(user.role, user.pageAccess.map((entry) => entry.page));
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.adminUserId || (req.session.role !== 'ADMIN' && req.session.role !== 'OWNER')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requirePageAccess(page: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.adminUserId || !req.session.role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.session.role === 'ADMIN' || req.session.role === 'OWNER') return next();
    if (req.session.allowedPages?.includes(page)) return next();
    return res.status(403).json({ error: 'Not authorized for this page' });
  };
}
