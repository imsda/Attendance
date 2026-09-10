import { Router } from 'express';
import { AttendanceResult } from '@prisma/client';
import { prisma } from '../db.js';
import { attendancePeriods, isDateKey } from '../utils/dates.js';
import { getSettings } from '../services/settingsService.js';

const router = Router();

router.get('/', async (req, res) => {
  const settings = await getSettings();
  const periods = attendancePeriods(settings.timezone);
  const from = isDateKey(req.query.from) ? req.query.from : periods.weekStart;
  const to = isDateKey(req.query.to) ? req.query.to : periods.today;
  if (from > to) return res.status(400).json({ error: 'From date must be before To date.' });
  const students = await prisma.student.findMany({
    where: { active: true },
    include: { attendances: { where: { result: AttendanceResult.SUCCESS, attendanceDate: { gte: from, lte: to } }, select: { attendanceDate: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
  });
  const rows = students.map((student) => ({
    id: student.id, studentId: student.studentId, firstName: student.firstName, lastName: student.lastName, grade: student.grade,
    count: student.attendances.length,
    dates: [...new Set(student.attendances.map((entry) => entry.attendanceDate))].sort()
  }));
  res.json({ from, to, totalAttendances: rows.reduce((sum, row) => sum + row.count, 0), studentsWithAttendance: rows.filter((row) => row.count > 0).length, rows });
});

export default router;
