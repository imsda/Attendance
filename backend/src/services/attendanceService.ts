import { AttendanceResult, Prisma } from '@prisma/client';
import { prisma, withSqliteTimeoutRetry } from '../db.js';
import { attendancePeriods, isWithinDailyTimeWindow, localDateKey, localTimeKey } from '../utils/dates.js';
import { getSettings } from './settingsService.js';

export type StudentTotals = { week: number; month: number; year: number; allTime: number };

export async function getStudentTotals(studentId: number, timezone: string): Promise<StudentTotals> {
  return (await getTotalsForStudents([studentId], timezone)).get(studentId)!;
}

// One grouped query per period instead of loading every attendance row.
export async function getTotalsForStudents(studentIds: number[], timezone: string) {
  const periods = attendancePeriods(timezone);
  const countFrom = (start?: string) => prisma.attendance.groupBy({
    by: ['studentId'],
    where: {
      studentId: { in: studentIds }, result: AttendanceResult.SUCCESS,
      ...(start ? { attendanceDate: { gte: start, lte: periods.today } } : {})
    },
    _count: { _all: true }
  });
  const [week, month, year, allTime] = await Promise.all([countFrom(periods.weekStart), countFrom(periods.monthStart), countFrom(periods.yearStart), countFrom()]);
  const totals = new Map<number, StudentTotals>(studentIds.map((id) => [id, { week: 0, month: 0, year: 0, allTime: 0 }]));
  const apply = (rows: Array<{ studentId: number | null; _count: { _all: number } }>, key: keyof StudentTotals) => {
    for (const row of rows) if (row.studentId != null) totals.get(row.studentId)![key] = row._count._all;
  };
  apply(week, 'week'); apply(month, 'month'); apply(year, 'year'); apply(allTime, 'allTime');
  return totals;
}

export const FAILED_SCAN_RETENTION_DAYS = 30;

export async function purgeOldFailedScans(now = new Date()) {
  const cutoff = new Date(now.getTime() - FAILED_SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.attendance.deleteMany({ where: { result: AttendanceResult.FAILURE, timestamp: { lt: cutoff } } });
  return count;
}

let cleanupTimer: NodeJS.Timeout | null = null;

export function startFailedScanCleanup() {
  if (cleanupTimer) return;
  const run = async () => {
    try {
      const count = await purgeOldFailedScans();
      if (count) console.log(`[CLEANUP] Removed ${count} failed scan(s) older than ${FAILED_SCAN_RETENTION_DAYS} days.`);
    } catch (error) {
      console.error('[CLEANUP] Failed scan cleanup failed.', error);
    }
  };
  void run();
  cleanupTimer = setInterval(run, 6 * 60 * 60 * 1000);
  cleanupTimer.unref();
}

export async function processAttendance(rawValue: string, adminUserId?: number) {
  const scannedValue = rawValue.trim();
  const settings = await getSettings();
  const attendanceDate = localDateKey(new Date(), settings.timezone);
  const student = await prisma.student.findFirst({
    where: { OR: [{ barcode: scannedValue }, { studentId: scannedValue }] }
  });

  if (settings.chapelScanWindowEnabled) {
    const currentTime = localTimeKey(new Date(), settings.timezone);
    if (!isWithinDailyTimeWindow(currentTime, settings.chapelScanStartTime, settings.chapelScanEndTime)) {
      await prisma.attendance.create({ data: {
        attendanceDate, scannedValue, result: AttendanceResult.FAILURE,
        failureReason: 'OUTSIDE_CHAPEL_HOURS', stationName: settings.stationName, adminUserId, studentId: student?.id
      } });
      return {
        ok: false as const,
        reason: 'OUTSIDE_CHAPEL_HOURS',
        error: `Chapel check-in is open from ${settings.chapelScanStartTime} to ${settings.chapelScanEndTime}.`,
        student: student || undefined
      };
    }
  }

  if (!student) {
    await prisma.attendance.create({ data: {
      attendanceDate, scannedValue, result: AttendanceResult.FAILURE,
      failureReason: 'STUDENT_NOT_FOUND', stationName: settings.stationName, adminUserId
    } });
    return { ok: false as const, reason: 'STUDENT_NOT_FOUND', error: 'Student not found. Try a name lookup or check the roster.' };
  }

  if (!student.active) {
    await prisma.attendance.create({ data: {
      attendanceDate, scannedValue, result: AttendanceResult.FAILURE,
      failureReason: 'STUDENT_INACTIVE', stationName: settings.stationName, adminUserId, studentId: student.id
    } });
    return { ok: false as const, reason: 'STUDENT_INACTIVE', error: `${student.firstName} ${student.lastName} is inactive.` };
  }

  if (settings.oneAttendancePerDay) {
    const existing = await prisma.attendance.findFirst({
      where: { studentId: student.id, result: AttendanceResult.SUCCESS, attendanceDate }
    });
    if (existing) {
      await prisma.attendance.create({ data: {
        attendanceDate, scannedValue, result: AttendanceResult.FAILURE,
        failureReason: 'ALREADY_CHECKED_IN', stationName: settings.stationName, adminUserId, studentId: student.id
      } });
      return {
        ok: false as const,
        reason: 'ALREADY_CHECKED_IN',
        error: `${student.firstName} ${student.lastName} is already checked in for chapel today.`,
        student,
        totals: await getStudentTotals(student.id, settings.timezone)
      };
    }
  }

  try {
    await withSqliteTimeoutRetry('record attendance', () => prisma.attendance.create({ data: {
      attendanceDate,
      dailyKey: settings.oneAttendancePerDay ? `${student.id}:${attendanceDate}` : null,
      scannedValue, result: AttendanceResult.SUCCESS,
      stationName: settings.stationName, adminUserId, studentId: student.id
    } }));
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    await prisma.attendance.create({ data: {
      attendanceDate, scannedValue, result: AttendanceResult.FAILURE,
      failureReason: 'ALREADY_CHECKED_IN', stationName: settings.stationName, adminUserId, studentId: student.id
    } });
    return {
      ok: false as const,
      reason: 'ALREADY_CHECKED_IN',
      error: `${student.firstName} ${student.lastName} is already checked in for chapel today.`,
      student,
      totals: await getStudentTotals(student.id, settings.timezone)
    };
  }

  return {
    ok: true as const,
    student,
    attendanceDate,
    totals: await getStudentTotals(student.id, settings.timezone)
  };
}
