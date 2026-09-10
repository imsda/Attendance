import { Router } from 'express';
import { AttendanceResult } from '@prisma/client';
import { prisma } from '../db.js';
import { attendancePeriods } from '../utils/dates.js';
import { getSettings } from '../services/settingsService.js';

const router = Router();

router.get('/', async (_req, res) => {
  const settings = await getSettings();
  const periods = attendancePeriods(settings.timezone);
  const [activeStudents, successful, failedToday, recent] = await Promise.all([
    prisma.student.count({ where: { active: true } }),
    prisma.attendance.findMany({ where: { result: AttendanceResult.SUCCESS }, select: { attendanceDate: true } }),
    prisma.attendance.count({ where: { result: AttendanceResult.FAILURE, attendanceDate: periods.today } }),
    prisma.attendance.findMany({ include: { student: true }, orderBy: { timestamp: 'desc' }, take: 12 })
  ]);
  const countSince = (start: string) => successful.filter((row) => row.attendanceDate >= start && row.attendanceDate <= periods.today).length;
  res.json({
    counts: { today: countSince(periods.today), week: countSince(periods.weekStart), month: countSince(periods.monthStart), year: countSince(periods.yearStart), activeStudents, failedToday },
    periods,
    recent
  });
});

export default router;
