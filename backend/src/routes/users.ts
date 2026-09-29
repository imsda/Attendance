import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AppPage, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ALL_PAGES, allowedPagesFor, credentialStamp } from '../services/access.js';

const router = Router();
const isOwnerSession = (req: any) => req.session?.role === 'OWNER';
const minPasswordFor = (role: UserRole) => (role === 'SCANNER' ? 4 : 12);

const createSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(200),
  role: z.enum(['OWNER', 'ADMIN', 'SCANNER', 'REPORTER']).default('ADMIN')
});
const updateSchema = z.object({
  password: z.string().max(200).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'SCANNER', 'REPORTER', 'CUSTOM']).optional(),
  allowedPages: z.array(z.string()).optional()
});

function normalizePages(input: string[]): AppPage[] { const allowed = new Set<string>(ALL_PAGES); return [...new Set(input.filter((p) => allowed.has(p)))] as AppPage[]; }
function validationError(error: z.ZodError) { return error.issues[0]?.message || 'Invalid request'; }

router.get('/', async (_req, res) => { const users = await prisma.adminUser.findMany({ orderBy: { username: 'asc' }, include: { pageAccess: true } }); res.json(users.map((u)=>({id:u.id,username:u.username,role:u.role,createdAt:u.createdAt,updatedAt:u.updatedAt,allowedPages:allowedPagesFor(u.role,u.pageAccess.map(e=>e.page))}))); });

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) });
  const { username, password, role: requestedRole } = parsed.data;
  if (requestedRole === 'OWNER' && !isOwnerSession(req)) return res.status(403).json({ error: 'Only OWNER can create OWNER users' });

  const minPassword = minPasswordFor(requestedRole);
  if (password.length < minPassword) {
    return res.status(400).json({ error: `Password must be at least ${minPassword} characters for ${requestedRole} accounts` });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const created = await prisma.adminUser.create({ data: { username, passwordHash, role: requestedRole } });
    res.status(201).json({ id: created.id, username: created.username, role: created.role, allowedPages: allowedPagesFor(created.role, []) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'That username is already in use' });
    throw error;
  }
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) });
  const existing = await prisma.adminUser.findUnique({ where: { id } }); if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.role === 'OWNER' && !isOwnerSession(req)) return res.status(403).json({ error: 'Only OWNER can manage OWNER users' });
  const { password, allowedPages } = parsed.data;
  const requestedRole: UserRole = parsed.data.role ?? existing.role;
  if (requestedRole === 'OWNER' && !isOwnerSession(req)) return res.status(403).json({ error: 'Only OWNER can assign OWNER role' });
  if (existing.role === 'OWNER' && requestedRole !== 'OWNER') {
    const ownerCount = await prisma.adminUser.count({ where: { role: 'OWNER' } });
    if (ownerCount <= 1) return res.status(400).json({ error: 'Cannot demote the last OWNER' });
  }
  const minPassword = minPasswordFor(requestedRole);
  if (password && password.length < minPassword) {
    return res.status(400).json({ error: `Password must be at least ${minPassword} characters for ${requestedRole} accounts` });
  }
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  // Page access only applies to CUSTOM users. Keep what they have unless the
  // request supplies a new list or moves the user to a fixed role.
  const replacePages = requestedRole !== 'CUSTOM' || allowedPages !== undefined;
  const safePages = requestedRole === 'CUSTOM' ? normalizePages(allowedPages ?? []) : [];

  const updated = await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id }, data: { role: requestedRole, passwordHash } });
    if (replacePages) {
      await tx.userPageAccess.deleteMany({ where: { adminUserId: id } });
      if (safePages.length > 0) await tx.userPageAccess.createMany({ data: safePages.map((page) => ({ adminUserId: id, page })) });
    }
    return tx.adminUser.findUniqueOrThrow({ where: { id }, include: { pageAccess: true } });
  });
  // Changing a password signs out that user's sessions; keep the caller's own
  // session valid when they change their own password.
  if (passwordHash && id === req.session.adminUserId) req.session.credentialStamp = credentialStamp(passwordHash);
  res.json({ id: updated.id, username: updated.username, role: updated.role, allowedPages: allowedPagesFor(updated.role, updated.pageAccess.map((entry) => entry.page)) });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
  const target = await prisma.adminUser.findUnique({ where: { id } }); if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'OWNER' && !isOwnerSession(req)) return res.status(403).json({ error: 'Only OWNER can manage OWNER users' });
  if (target.role === 'OWNER') { const ownerCount = await prisma.adminUser.count({ where: { role: 'OWNER' } }); if (ownerCount <= 1) return res.status(400).json({ error: 'Cannot delete the last OWNER' }); }
  if (id === req.session.adminUserId) return res.status(400).json({ error: 'You cannot delete your own account' });
  await prisma.adminUser.delete({ where: { id } }); res.json({ ok: true });
});

export default router;
