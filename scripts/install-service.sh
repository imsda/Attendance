#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-${USER:-manager}}"
ARCHITECTURE="$(uname -m)"

if [[ -z "${SERVICE_USER}" ]]; then
  SERVICE_USER="manager"
fi

echo "Using project root: ${PROJECT_ROOT}"
echo "Using service user: ${SERVICE_USER}"
echo "[UPDATE] Architecture detected: ${ARCHITECTURE}"

run_step() {
  local label="$1"
  shift
  echo "[UPDATE] Starting: ${label}"
  if "$@"; then
    echo "[UPDATE] Success: ${label}"
  else
    echo "[UPDATE] ERROR: Failed: ${label}" >&2
    exit 1
  fi
}

run_as_service_user() {
  if [[ "${EUID}" -eq 0 && "${SERVICE_USER}" != "root" ]]; then
    sudo -H -u "${SERVICE_USER}" "$@"
  else
    "$@"
  fi
}

is_linux_arm64() {
  [[ "$(uname -s)" == "Linux" && ( "$ARCHITECTURE" == "aarch64" || "$ARCHITECTURE" == "arm64" ) ]]
}

ensure_arm64_rollup_compat() {
  # npm can skip optional platform packages, which may leave ARM64 Linux
  # missing Rollup's native binary package after install/update operations.
  # We use --no-save so package.json/package-lock.json are not modified by
  # updater/install scripts; this is a runtime compatibility fix only.
  if is_linux_arm64; then
    echo "[UPDATE] ARM64 detected; ensuring Rollup native dependency exists."
    run_as_service_user npm install --no-save @rollup/rollup-linux-arm64-gnu || {
      echo "[UPDATE] ERROR: Failed to install @rollup/rollup-linux-arm64-gnu on ARM64." >&2
      exit 1
    }
  fi
}

run_step "npm install" run_as_service_user npm install
run_step "ensure ARM64 Rollup compatibility dependency" ensure_arm64_rollup_compat

echo "Building full app for production (frontend + backend)..."
run_as_service_user npm run build

SERVICE_FILE="/etc/systemd/system/chapel-attendance.service"

# Stop the existing process before migrating SQLite so schema upgrades cannot
# race with live application queries. The migration preserves existing data.
if sudo systemctl is-active --quiet chapel-attendance 2>/dev/null; then
  echo "Stopping Chapel Attendance before database migration..."
  sudo systemctl stop chapel-attendance
fi

run_step "database migrations" run_as_service_user npm run db:migrate
run_step "database migration status" run_as_service_user npm run db:status

echo "Writing systemd service file to ${SERVICE_FILE}..."
sudo tee "${SERVICE_FILE}" > /dev/null <<SERVICE
[Unit]
Description=Chapel Attendance Service
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=/usr/bin/npm run start -w backend
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "Enabling chapel-attendance service for boot..."
sudo systemctl enable chapel-attendance

echo "Restarting chapel-attendance service..."
sudo systemctl restart chapel-attendance

echo "Chapel Attendance service installed and started successfully."
FRONTEND_PORT="$(sed -n 's/^VITE_PORT=//p' "${PROJECT_ROOT}/frontend/.env" | tail -n 1 | tr -d '\"' || true)"
echo "Production app is served from the backend on port ${FRONTEND_PORT:-4000} (frontend + API)."
