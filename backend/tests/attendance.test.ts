import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'chapel-attendance-'));
const databasePath = join(directory, 'test.db');
process.env.DATABASE_URL = `file:${databasePath}`;
const migration = readFileSync('prisma/migrations/0001_init/migration.sql', 'utf8');
const database = new DatabaseSync(databasePath);
database.exec(migration);
database.exec(readFileSync('prisma/migrations/0003_add_chapel_scan_window/migration.sql', 'utf8'));
database.close();

const { prisma } = await import('../src/db.js');
const { processAttendance, getStudentTotals } = await import('../src/services/attendanceService.js');
const { searchStudents } = await import('../src/services/searchStudents.js');
const { attendancePeriods, isWithinDailyTimeWindow, localDateKey, localTimeKey } = await import('../src/utils/dates.js');

test.after(async () => { await prisma.$disconnect(); });

test('records one chapel attendance per student per local day', async () => {
  await prisma.setting.create({ data: { id: 1, timezone: 'America/Chicago', oneAttendancePerDay: true } });
  const student = await prisma.student.create({ data: { studentId: 'S100', barcode: '0123456789', firstName: 'Jane', lastName: 'Smith', grade: '10' } });
  const first = await processAttendance('0123456789');
  const duplicate = await processAttendance('S100');
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'ALREADY_CHECKED_IN');
  assert.equal(await prisma.attendance.count({ where: { studentId: student.id, result: 'SUCCESS' } }), 1);
  assert.equal(await prisma.attendance.count({ where: { studentId: student.id, result: 'FAILURE' } }), 1);
});

test('supports name and ID lookup', async () => {
  assert.equal((await searchStudents('Jane Smith'))[0]?.studentId, 'S100');
  assert.equal((await searchStudents('012345'))[0]?.studentId, 'S100');
});

test('computes week, month, year, and all-time totals', async () => {
  const student = await prisma.student.findUniqueOrThrow({ where: { studentId: 'S100' } });
  const periods = attendancePeriods('America/Chicago');
  await prisma.attendance.create({ data: { attendanceDate: '2000-01-01', scannedValue: 'S100', result: 'SUCCESS', studentId: student.id } });
  const totals = await getStudentTotals(student.id, 'America/Chicago');
  assert.equal(totals.week, 1);
  assert.equal(totals.month, 1);
  assert.equal(totals.year, 1);
  assert.equal(totals.allTime, 2);
  assert.equal(localDateKey(new Date(), 'America/Chicago'), periods.today);
});

test('enforces normal and overnight chapel scan windows', () => {
  assert.equal(isWithinDailyTimeWindow('08:30', '07:00', '09:00'), true);
  assert.equal(isWithinDailyTimeWindow('09:01', '07:00', '09:00'), false);
  assert.equal(isWithinDailyTimeWindow('23:30', '22:00', '02:00'), true);
  assert.equal(isWithinDailyTimeWindow('01:30', '22:00', '02:00'), true);
  assert.equal(isWithinDailyTimeWindow('12:00', '22:00', '02:00'), false);
  assert.match(localTimeKey(new Date(), 'America/Chicago'), /^\d{2}:\d{2}$/);
});
