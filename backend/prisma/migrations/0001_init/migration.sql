-- CreateTable
CREATE TABLE "AdminUser" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'ADMIN',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

CREATE TABLE "UserPageAccess" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "adminUserId" INTEGER NOT NULL,
  "page" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserPageAccess_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserPageAccess_adminUserId_page_key" ON "UserPageAccess"("adminUserId", "page");
CREATE INDEX "UserPageAccess_adminUserId_idx" ON "UserPageAccess"("adminUserId");

CREATE TABLE "Student" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "studentId" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "grade" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");
CREATE UNIQUE INDEX "Student_barcode_key" ON "Student"("barcode");
CREATE INDEX "Student_lastName_firstName_idx" ON "Student"("lastName", "firstName");

CREATE TABLE "Setting" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "schoolName" TEXT NOT NULL DEFAULT 'Sunnydale Adventist Academy',
  "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "stationName" TEXT NOT NULL DEFAULT 'Main Chapel Entrance',
  "scannerCooldownSeconds" REAL NOT NULL DEFAULT 1,
  "scannerDiagnosticsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "enableSounds" BOOLEAN NOT NULL DEFAULT true,
  "oneAttendancePerDay" BOOLEAN NOT NULL DEFAULT true,
  "hideInactiveByDefault" BOOLEAN NOT NULL DEFAULT true,
  "googleSheetsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "googleSheetId" TEXT NOT NULL DEFAULT '',
  "googleRosterTabName" TEXT NOT NULL DEFAULT 'Students',
  "googleAttendanceTabName" TEXT NOT NULL DEFAULT 'Attendance',
  "googleSummaryTabName" TEXT NOT NULL DEFAULT 'Attendance Summary',
  "googleSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "googleAutoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "googleLastSyncAt" DATETIME,
  "googleLastSyncSummary" TEXT,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Attendance" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attendanceDate" TEXT NOT NULL,
  "dailyKey" TEXT,
  "scannedValue" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "failureReason" TEXT,
  "stationName" TEXT,
  "studentId" INTEGER,
  "adminUserId" INTEGER,
  "googleSyncedAt" DATETIME,
  CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Attendance_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Attendance_dailyKey_key" ON "Attendance"("dailyKey");
CREATE INDEX "Attendance_studentId_result_attendanceDate_idx" ON "Attendance"("studentId", "result", "attendanceDate");
CREATE INDEX "Attendance_result_timestamp_idx" ON "Attendance"("result", "timestamp");
CREATE INDEX "Attendance_googleSyncedAt_idx" ON "Attendance"("googleSyncedAt");

CREATE TABLE "ImportHistory" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "source" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL,
  "successRows" INTEGER NOT NULL,
  "failedRows" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorSummary" TEXT
);
