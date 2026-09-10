export type AttendanceTotals = { week: number; month: number; year: number; allTime: number };

export type Student = {
  id: number;
  studentId: string;
  barcode: string;
  firstName: string;
  lastName: string;
  grade: string | null;
  active: boolean;
  notes?: string | null;
  totals?: AttendanceTotals;
};

export type Attendance = {
  id: number;
  timestamp: string;
  attendanceDate: string;
  scannedValue: string;
  result: 'SUCCESS' | 'FAILURE';
  failureReason: string | null;
  stationName: string | null;
  googleSyncedAt: string | null;
  student: Student | null;
  adminUser?: { username: string } | null;
};

export type Settings = {
  id: number;
  schoolName: string;
  timezone: string;
  stationName: string;
  scannerCooldownSeconds: number;
  scannerDiagnosticsEnabled: boolean;
  enableSounds: boolean;
  oneAttendancePerDay: boolean;
  hideInactiveByDefault: boolean;
  googleSheetsEnabled: boolean;
  googleSheetId: string;
  googleRosterTabName: string;
  googleAttendanceTabName: string;
  googleSummaryTabName: string;
  googleSyncIntervalMinutes: number;
  googleAutoSyncEnabled: boolean;
  googleLastSyncAt: string | null;
  googleLastSyncSummary: string | null;
  updatedAt: string;
};
