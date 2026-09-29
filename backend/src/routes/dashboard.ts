import { Router } from 'express';
import { AttendanceResult } from '@prisma/client';
import { prisma } from '../db.js';
import { attendancePeriods } from '../utils/dates.js';
import { getSettings } from '../services/settingsService.js';

const router = Router();

router.get('/', async (_req, res) => {
  const settings = await getSettings();
  const periods = attendancePeriods(settings.timezone);
  const countSince = (start: string) => prisma.attendance.count({ where: { result: AttendanceResult.SUCCESS, attendanceDate: { gte: start, lte: periods.today } } });
  const [activeStudents, today, week, month, year, failedToday, recent] = await Promise.all([
    prisma.student.count({ where: { active: true } }),
    countSince(periods.today), countSince(periods.weekStart), countSince(periods.monthStart), countSince(periods.yearStart),
    prisma.attendance.count({ where: { result: AttendanceResult.FAILURE, attendanceDate: periods.today } }),
    prisma.attendance.findMany({ include: { student: true }, orderBy: { timestamp: 'desc' }, take: 12 })
  ]);
  res.json({
    counts: { today, week, month, year, activeStudents, failedToday },
    periods,
    recent
  });
});

export default router;
