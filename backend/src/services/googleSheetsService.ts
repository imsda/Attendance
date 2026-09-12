import { google, sheets_v4 } from 'googleapis';
import { AttendanceResult, Prisma } from '@prisma/client';
import { createPrivateKey } from 'node:crypto';
import { prisma } from '../db.js';
import { attendancePeriods } from '../utils/dates.js';
import { getSettings } from './settingsService.js';

const ROSTER_HEADERS = ['Student ID', 'First Name', 'Last Name', 'Grade', 'Active', 'Barcode', 'This Week', 'This Month', 'This Year', 'All Time'];
const ATTENDANCE_HEADERS = ['Timestamp', 'Date', 'Student ID', 'First Name', 'Last Name', 'Grade', 'Station'];
const SUMMARY_HEADERS = ['Student ID', 'Name', 'Grade', 'This Week', 'This Month', 'This Year', 'All Time', 'Last Attendance'];
let running: Promise<GoogleSyncResult> | null = null;
let scheduler: NodeJS.Timeout | null = null;

export type GoogleSyncResult = {
  imported: number;
  failed: number;
  attendanceRowsAppended: number;
  summariesUpdated: number;
  errors: string[];
};

function sheetRange(tab: string, range: string) {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

function booleanCell(value: unknown, defaultValue = true) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !['false', 'no', 'n', '0', 'inactive'].includes(normalized);
}

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return urlMatch?.[1] ?? trimmed;
}

export function normalizeGooglePrivateKey(input: string): string {
  let key = input.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  return key.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const encodedPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64?.trim();
  const privateKeySource = encodedPrivateKey
    ? Buffer.from(encodedPrivateKey, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const privateKey = normalizeGooglePrivateKey(privateKeySource);
  if (!clientEmail || !privateKey) {
    throw new Error('Google service account credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and either GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
  }
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('Google service account private key is malformed. Copy the complete private_key value, including the BEGIN/END PRIVATE KEY lines.');
  }

  let signingKey: string;
  try {
    signingKey = createPrivateKey(privateKey).export({ type: 'pkcs8', format: 'pem' }).toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to decode the private key.';
    throw new Error(`Google service account private key could not be parsed: ${message}`);
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: signingKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTabs(sheets: sheets_v4.Sheets, spreadsheetId: string, titles: string[]) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existing = new Set(metadata.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) as string[]);
  const missing = titles.filter((title) => !existing.has(title));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }
    });
  }
}

async function ensureHeader(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: string, headers: string[]) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(tab, `A1:${String.fromCharCode(64 + headers.length)}1`),
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });
}

function normalizeHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function rowValue(row: unknown[], headerMap: Map<string, number>, names: string[]) {
  for (const name of names) {
    const index = headerMap.get(normalizeHeader(name));
    if (index !== undefined) return String(row[index] ?? '').trim();
  }
  return '';
}

async function importRoster(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: string, errors: string[]) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetRange(tab, 'A:Z') });
  const values = response.data.values || [];
  if (values.length === 0) {
    await ensureHeader(sheets, spreadsheetId, tab, ROSTER_HEADERS);
    return { imported: 0, failed: 0, rows: [] as unknown[][] };
  }

  const headerMap = new Map(values[0].map((value, index) => [normalizeHeader(value), index]));
  let imported = 0;
  let failed = 0;
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const studentId = rowValue(row, headerMap, ['Student ID', 'ID']);
    const firstName = rowValue(row, headerMap, ['First Name']);
    const lastName = rowValue(row, headerMap, ['Last Name']);
    if (!studentId && !firstName && !lastName) continue;
    if (!studentId || !firstName || !lastName) {
      failed += 1;
      errors.push(`Students row ${index + 1}: Student ID, First Name, and Last Name are required.`);
      continue;
    }
    const barcode = rowValue(row, headerMap, ['Barcode']) || studentId;
    try {
      await prisma.student.upsert({
        where: { studentId },
        create: {
          studentId, barcode, firstName, lastName,
          grade: rowValue(row, headerMap, ['Grade']) || null,
          active: booleanCell(rowValue(row, headerMap, ['Active']))
        },
        update: {
          barcode, firstName, lastName,
          grade: rowValue(row, headerMap, ['Grade']) || null,
          active: booleanCell(rowValue(row, headerMap, ['Active']))
        }
      });
      imported += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? `Barcode ${barcode} is already assigned to another student.`
        : (error instanceof Error ? error.message : 'Unknown error');
      errors.push(`Students row ${index + 1}: ${message}`);
    }
  }
  return { imported, failed, rows: values };
}

type Totals = { week: number; month: number; year: number; allTime: number; lastAttendance: string };

async function buildTotals(timezone: string) {
  const periods = attendancePeriods(timezone);
  const rows = await prisma.attendance.findMany({
    where: { result: AttendanceResult.SUCCESS, studentId: { not: null } },
    select: { studentId: true, attendanceDate: true }
  });
  const totals = new Map<number, Totals>();
  for (const row of rows) {
    if (row.studentId == null) continue;
    const current = totals.get(row.studentId) || { week: 0, month: 0, year: 0, allTime: 0, lastAttendance: '' };
    current.allTime += 1;
    if (row.attendanceDate >= periods.yearStart && row.attendanceDate <= periods.today) current.year += 1;
    if (row.attendanceDate >= periods.monthStart && row.attendanceDate <= periods.today) current.month += 1;
    if (row.attendanceDate >= periods.weekStart && row.attendanceDate <= periods.today) current.week += 1;
    if (row.attendanceDate > current.lastAttendance) current.lastAttendance = row.attendanceDate;
    totals.set(row.studentId, current);
  }
  return totals;
}

async function appendAttendanceLog(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: string) {
  const pending = await prisma.attendance.findMany({
    where: { result: AttendanceResult.SUCCESS, googleSyncedAt: null },
    include: { student: true },
    orderBy: { id: 'asc' },
    take: 1000
  });
  if (!pending.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetRange(tab, 'A:G'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: pending.map((entry) => [
      entry.timestamp.toISOString(), entry.attendanceDate, entry.student?.studentId || entry.scannedValue,
      entry.student?.firstName || '', entry.student?.lastName || '', entry.student?.grade || '', entry.stationName || ''
    ]) }
  });
  await prisma.attendance.updateMany({ where: { id: { in: pending.map((entry) => entry.id) } }, data: { googleSyncedAt: new Date() } });
  return pending.length;
}

async function writeSummaries(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rosterTab: string,
  summaryTab: string,
  rosterRows: unknown[][],
  totals: Map<number, Totals>
) {
  const students = await prisma.student.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const byStudentId = new Map(students.map((student) => [student.studentId, student]));

  if (rosterRows.length > 1) {
    const headerMap = new Map(rosterRows[0].map((value, index) => [normalizeHeader(value), index]));
    const countRows = rosterRows.slice(1).map((row) => {
      const student = byStudentId.get(rowValue(row, headerMap, ['Student ID', 'ID']));
      const value = student ? totals.get(student.id) : undefined;
      return [value?.week || 0, value?.month || 0, value?.year || 0, value?.allTime || 0];
    });
    if (countRows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: sheetRange(rosterTab, `G2:J${countRows.length + 1}`),
        valueInputOption: 'RAW',
        requestBody: { values: countRows }
      });
    }
  }

  const summaryRows = students.map((student) => {
    const value = totals.get(student.id);
    return [student.studentId, `${student.firstName} ${student.lastName}`.trim(), student.grade || '', value?.week || 0, value?.month || 0, value?.year || 0, value?.allTime || 0, value?.lastAttendance || ''];
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetRange(summaryTab, 'A2:H') });
  if (summaryRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(summaryTab, `A2:H${summaryRows.length + 1}`),
      valueInputOption: 'RAW',
      requestBody: { values: summaryRows }
    });
  }
  return students.length;
}

async function executeGoogleSync(): Promise<GoogleSyncResult> {
  const settings = await getSettings();
  if (!settings.googleSheetsEnabled) throw new Error('Google Sheets sync is disabled in Settings.');
  const spreadsheetId = parseSpreadsheetId(settings.googleSheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '');
  if (!spreadsheetId) throw new Error('A Google Sheet URL or Spreadsheet ID is required.');
  const sheets = getSheetsClient();
  const errors: string[] = [];
  await ensureTabs(sheets, spreadsheetId, [settings.googleRosterTabName, settings.googleAttendanceTabName, settings.googleSummaryTabName]);
  await ensureHeader(sheets, spreadsheetId, settings.googleRosterTabName, ROSTER_HEADERS);
  await ensureHeader(sheets, spreadsheetId, settings.googleAttendanceTabName, ATTENDANCE_HEADERS);
  await ensureHeader(sheets, spreadsheetId, settings.googleSummaryTabName, SUMMARY_HEADERS);

  const roster = await importRoster(sheets, spreadsheetId, settings.googleRosterTabName, errors);
  const attendanceRowsAppended = await appendAttendanceLog(sheets, spreadsheetId, settings.googleAttendanceTabName);
  const totals = await buildTotals(settings.timezone);
  const summariesUpdated = await writeSummaries(sheets, spreadsheetId, settings.googleRosterTabName, settings.googleSummaryTabName, roster.rows, totals);
  const result = { imported: roster.imported, failed: roster.failed, attendanceRowsAppended, summariesUpdated, errors };
  const summary = `${roster.imported} roster rows imported; ${attendanceRowsAppended} attendance rows exported; ${summariesUpdated} summaries updated${roster.failed ? `; ${roster.failed} failed` : ''}.`;
  await prisma.$transaction([
    prisma.setting.update({ where: { id: 1 }, data: { googleLastSyncAt: new Date(), googleLastSyncSummary: summary } }),
    prisma.importHistory.create({ data: { source: 'Google Sheets', totalRows: roster.imported + roster.failed, successRows: roster.imported, failedRows: roster.failed, errorSummary: errors.slice(0, 20).join('\n') || null } })
  ]);
  return result;
}

async function executeRosterImport(): Promise<GoogleSyncResult> {
  const settings = await getSettings();
  if (!settings.googleSheetsEnabled) throw new Error('Google Sheets sync is disabled in Settings.');
  const spreadsheetId = parseSpreadsheetId(settings.googleSheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '');
  if (!spreadsheetId) throw new Error('A Google Sheet URL or Spreadsheet ID is required.');
  const sheets = getSheetsClient();
  const errors: string[] = [];
  await ensureTabs(sheets, spreadsheetId, [settings.googleRosterTabName]);
  await ensureHeader(sheets, spreadsheetId, settings.googleRosterTabName, ROSTER_HEADERS);
  const roster = await importRoster(sheets, spreadsheetId, settings.googleRosterTabName, errors);
  return { imported: roster.imported, failed: roster.failed, attendanceRowsAppended: 0, summariesUpdated: 0, errors };
}

async function executeWriteBack(): Promise<GoogleSyncResult> {
  const settings = await getSettings();
  if (!settings.googleSheetsEnabled) throw new Error('Google Sheets sync is disabled in Settings.');
  const spreadsheetId = parseSpreadsheetId(settings.googleSheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '');
  if (!spreadsheetId) throw new Error('A Google Sheet URL or Spreadsheet ID is required.');
  const sheets = getSheetsClient();
  const errors: string[] = [];
  await ensureTabs(sheets, spreadsheetId, [settings.googleRosterTabName, settings.googleAttendanceTabName, settings.googleSummaryTabName]);
  await ensureHeader(sheets, spreadsheetId, settings.googleAttendanceTabName, ATTENDANCE_HEADERS);
  await ensureHeader(sheets, spreadsheetId, settings.googleSummaryTabName, SUMMARY_HEADERS);
  const rosterResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetRange(settings.googleRosterTabName, 'A:Z') });
  const rosterRows = rosterResponse.data.values || [];
  const attendanceRowsAppended = await appendAttendanceLog(sheets, spreadsheetId, settings.googleAttendanceTabName);
  const totals = await buildTotals(settings.timezone);
  const summariesUpdated = await writeSummaries(sheets, spreadsheetId, settings.googleRosterTabName, settings.googleSummaryTabName, rosterRows, totals);
  return { imported: 0, failed: 0, attendanceRowsAppended, summariesUpdated, errors };
}

export function syncGoogleSheets() {
  if (!running) running = executeGoogleSync().finally(() => { running = null; });
  return running;
}

export function importGoogleRoster() {
  if (!running) running = executeRosterImport().finally(() => { running = null; });
  return running;
}

export function writeBackGoogleSheets() {
  if (!running) running = executeWriteBack().finally(() => { running = null; });
  return running;
}

export function startGoogleSheetsScheduler() {
  if (scheduler) return;
  scheduler = setInterval(async () => {
    try {
      const settings = await getSettings();
      if (!settings.googleSheetsEnabled || !settings.googleAutoSyncEnabled) return;
      const elapsed = settings.googleLastSyncAt ? Date.now() - settings.googleLastSyncAt.getTime() : Number.POSITIVE_INFINITY;
      if (elapsed >= Math.max(1, settings.googleSyncIntervalMinutes) * 60_000) await syncGoogleSheets();
    } catch (error) {
      console.error('[GOOGLE_SYNC]', error);
    }
  }, 60_000);
  scheduler.unref();
}

export { ROSTER_HEADERS, ATTENDANCE_HEADERS, SUMMARY_HEADERS };
