import { AttendanceResult, Prisma } from '@prisma/client';
import { prisma, withSqliteTimeoutRetry } from '../db.js';
import { attendancePeriods, localDateKey } from '../utils/dates.js';
import { getSettings } from './settingsService.js';

export async function getStudentTotals(studentId: number, timezone: string) {
  const periods = attendancePeriods(timezone);
  const rows = await prisma.attendance.findMany({
    where: { studentId, result: AttendanceResult.SUCCESS },
    select: { attendanceDate: true }
  });
  return {
    week: rows.filter((row) => row.attendanceDate >= periods.weekStart && row.attendanceDate <= periods.today).length,
    month: rows.filter((row) => row.attendanceDate >= periods.monthStart && row.attendanceDate <= periods.today).length,
    year: rows.filter((row) => row.attendanceDate >= periods.yearStart && row.attendanceDate <= periods.today).length,
    allTime: rows.length
  };
}

export async function processAttendance(rawValue: string, adminUserId?: number) {
  const scannedValue = rawValue.trim();
  const settings = await getSettings();
  const attendanceDate = localDateKey(new Date(), settings.timezone);
  const student = await prisma.student.findFirst({
    where: { OR: [{ barcode: scannedValue }, { studentId: scannedValue }] }
  });

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
