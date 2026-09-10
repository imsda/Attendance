import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { getSettings } from '../services/settingsService.js';
import { getStudentTotals } from '../services/attendanceService.js';

const router = Router();
const studentSchema = z.object({
  studentId: z.string().trim().min(1).max(100),
  barcode: z.string().trim().max(200).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  grade: z.string().trim().max(50).nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

router.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const includeInactive = req.query.includeInactive === 'true';
  const students = await prisma.student.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(query ? { OR: [
        { studentId: { contains: query } }, { barcode: { contains: query } },
        { firstName: { contains: query } }, { lastName: { contains: query } }
      ] } : {})
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 500
  });
  const settings = await getSettings();
  const withTotals = await Promise.all(students.map(async (student) => ({ ...student, totals: await getStudentTotals(student.id, settings.timezone) })));
  res.json(withTotals);
});

router.post('/', async (req, res) => {
  try {
    const payload = studentSchema.parse(req.body);
    const student = await prisma.student.create({ data: { ...payload, barcode: payload.barcode || payload.studentId, grade: payload.grade || null, notes: payload.notes || null } });
    res.status(201).json(student);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Invalid student.' });
    return res.status(400).json({ error: 'Student ID and barcode must be unique.' });
  }
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid student.' });
  try {
    const payload = studentSchema.partial().parse(req.body);
    const student = await prisma.student.update({ where: { id }, data: payload });
    res.json(student);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Invalid student.' });
    return res.status(400).json({ error: 'Unable to update student. Student ID and barcode must be unique.' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid student.' });
  await prisma.student.update({ where: { id }, data: { active: false } });
  res.json({ ok: true });
});

export default router;
