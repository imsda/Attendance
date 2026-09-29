import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { allowedPagesFor, credentialStamp } from '../services/access.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const loginAttempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 20;
const MAX_ATTEMPTS_PER_USERNAME = 10;
const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) });

function attemptRecord(key: string, now: number) {
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) return { count: 0, first: now };
  return rec;
}

function recordFailure(keys: string[], now: number) {
  for (const key of keys) {
    const rec = attemptRecord(key, now);
    rec.count += 1;
    loginAttempts.set(key, rec);
  }
}

// Drop expired records so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of loginAttempts) if (now - rec.first > WINDOW_MS) loginAttempts.delete(key);
}, WINDOW_MS).unref();

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Username and password are required.' });
  const { username, password } = parsed.data;

  // req.ip honors the "trust proxy" setting, so only the Traefik-appended
  // client address is used rather than a client-supplied X-Forwarded-For value.
  const now = Date.now();
  const ipKey = `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const userKey = `user:${username.toLowerCase()}`;
  if (attemptRecord(ipKey, now).count >= MAX_ATTEMPTS_PER_IP || attemptRecord(userKey, now).count >= MAX_ATTEMPTS_PER_USERNAME) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const user = await prisma.adminUser.findUnique({ where: { username }, include: { pageAccess: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    recordFailure([ipKey, userKey], now);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const allowedPages = allowedPagesFor(user.role, user.pageAccess.map((entry) => entry.page));
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  req.session.adminUserId = user.id;
  req.session.role = user.role;
  req.session.allowedPages = allowedPages;
  req.session.credentialStamp = credentialStamp(user.passwordHash);
  loginAttempts.delete(ipKey);
  loginAttempts.delete(userKey);
  res.json({ id: user.id, username: user.username, role: user.role, allowedPages });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.session.adminUserId }, select: { id: true, username: true, role: true } });
  res.json({ ...user, allowedPages: req.session.allowedPages });
});

export default router;
