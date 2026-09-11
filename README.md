# Chapel Attendance

A self-hosted chapel attendance application for Sunnydale Adventist Academy. It accepts student ID barcodes from a USB scanner or device camera, supports name/ID lookup, blocks accidental same-day duplicates, and reports chapel attendance by week, month, year, or any custom date range.

Built from the proven scanning, authentication, SQLite, deployment, and Google Sheets patterns in [imsda/CafeScanner](https://github.com/imsda/CafeScanner).

## Features

- Camera scanning for Code 128, Code 39, Code 93, Codabar, EAN, ITF, UPC, and QR codes.
- USB barcode scanner support (keyboard input plus Enter).
- Manual student ID entry and live name/ID/barcode lookup.
- One successful chapel attendance per student per local calendar day by default.
- Dashboard totals for today, the current week, month, and year.
- Per-student week, month, year, and all-time totals.
- Custom date-range reports with printable results.
- Active/inactive student roster and CSV import.
- Google Sheets roster import, attendance-log export, and summary write-back.
- OWNER, ADMIN, CUSTOM, and scanner-only accounts.
- SQLite storage, safe Prisma migrations, Docker, and systemd deployment helpers.

## Quick start

Requirements: Node.js 22+, npm, and Linux/macOS for the included shell scripts.

```bash
./scripts/setup.sh
npm run create-admin -w backend
npm run promote-owner -w backend
./scripts/dev.sh
```

Development URLs:

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000/api`

Production:

```bash
./scripts/build.sh
./scripts/start.sh
```

In production the backend serves the built frontend on port 4000.

## Configuration

`scripts/setup.sh` creates `backend/.env` and `frontend/.env` from their examples without overwriting existing values.

Backend values:

```dotenv
DATABASE_URL="file:./prisma/dev.db"
SESSION_SECRET="replace-with-a-long-random-secret"
PORT=4000
BACKEND_HOST="0.0.0.0"
CLIENT_ORIGIN="http://localhost:5173,http://127.0.0.1:5173"
GOOGLE_SERVICE_ACCOUNT_EMAIL="service-account@project.iam.gserviceaccount.com"
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID="optional-default-sheet-id"
```

Set `VITE_API_BASE=/api` in `frontend/.env` for same-origin production and reverse-proxy use.

Set the browser-facing production port in `frontend/.env`:

```dotenv
VITE_PORT=4000
VITE_DEV_PORT=5173
```

`VITE_PORT` controls the production Express listener that serves both the frontend and API. `VITE_DEV_PORT` controls only the Vite development server. Re-run `sudo ./scripts/install-service.sh` or restart `chapel-attendance` after changing the production port.

## Google Sheets setup

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Put the service account email and private key in `backend/.env`.
3. Share the desired Google Sheet with the service-account email as an **Editor**.
4. Open **Settings** in the app, enable Google Sheets, paste the full Google Sheet URL (or enter the Spreadsheet ID), and save.
5. Open **Roster & Sync** and select **Sync now**.

The app creates or uses three tabs:

### `Students`

This is the roster source. Use this exact header row:

```text
Student ID,First Name,Last Name,Grade,Active,Barcode,This Week,This Month,This Year,All Time
```

- `Student ID`, `First Name`, and `Last Name` are required.
- `Barcode` is optional and defaults to Student ID.
- `Active` accepts yes/no, true/false, 1/0, or active/inactive.
- The app imports the first six columns and writes calculated totals to the last four.
- Existing student IDs are updated rather than duplicated.

### `Attendance`

Append-only successful attendance log:

```text
Timestamp,Date,Student ID,First Name,Last Name,Grade,Station
```

Local SQLite remains the source of truth. A record is marked synced only after Google accepts the append, so interrupted syncs retry later.

### `Attendance Summary`

Rebuilt on every sync for easy sorting and filtering:

```text
Student ID,Name,Grade,This Week,This Month,This Year,All Time,Last Attendance
```

Automatic sync runs at the interval configured in Settings. Administrators can run a full sync, import only the roster, or write back only pending attendance and calculated totals.

## Barcode and camera notes

USB scanners generally work without special drivers: select **USB scanner / ID**, keep the input focused, and scan. The app submits when the scanner sends Enter.

Browser camera access requires HTTPS or localhost. On phones and tablets, serve the application through an HTTPS reverse proxy. Camera permission is requested only after the operator selects **Start Camera Scanner**. If camera access is unavailable, USB and manual modes remain usable.

## Attendance rules

By default, the first successful check-in for a student on a local calendar day counts. Further scans are recorded as rejected attempts and do not change totals. This rule is concurrency-safe: simultaneous scans cannot create two daily records. Administrators can disable the once-per-day rule in Settings if the academy needs multiple counted chapel events on one date.

The week begins Monday. Month and year totals use the calendar month/year in the configured timezone.

## Service management

```bash
sudo ./scripts/install-service.sh
./scripts/service-status.sh
./scripts/service-logs.sh
./scripts/service-restart.sh
```

The service is named `chapel-attendance`. Use `scripts/update-service.sh` for safe pull, build, migration, and restart updates.

## Docker

```bash
docker compose up -d --build
```

Persist `backend/prisma` so the SQLite database survives container recreation.

## Data safety

- Normal setup and updates use `prisma migrate deploy`; they do not reset attendance.
- Successful Google attendance export is append-only.
- Keep regular backups of the SQLite database and its `-wal`/`-shm` files.
- Use a long random `SESSION_SECRET` and HTTPS in production.
