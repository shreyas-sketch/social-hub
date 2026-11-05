#!/usr/bin/env bash
# After copying up a new version: backs up the database, builds, migrates, restarts both services.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
set -a; . /etc/social-hub.env; set +a
npm run backup
npm ci
npm run build
npm run migrate
chown -R socialhub:socialhub "$APP_DIR"
systemctl restart social-hub social-hub-worker
echo "Updated. Logs: journalctl -u social-hub -u social-hub-worker -f"
