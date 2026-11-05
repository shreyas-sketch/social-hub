#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 VPS (2 vCPU / 4 GB RAM or more — video edits need it).
#   bash deploy/vps-setup.sh social.yourdomain.com you@yourdomain.com
# Installs Node 22, ffmpeg, Nginx, whisper.cpp (free captions); builds the app; creates the
# database in /var/lib/social-hub; writes /etc/social-hub.env with fresh secrets; installs two
# services (web + worker) that restart on crash and reboot; gets an HTTPS certificate; and
# schedules a nightly database backup.
set -euo pipefail

DOMAIN="${1:?Usage: bash deploy/vps-setup.sh <domain> <email>}"
EMAIL="${2:?Usage: bash deploy/vps-setup.sh <domain> <email>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA=/var/lib/social-hub
ENV_FILE=/etc/social-hub.env

echo "==> Packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx ffmpeg git cmake build-essential sqlite3
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y certbot python3-certbot-nginx

echo "==> whisper.cpp (captions, runs on this server for free)"
if [ ! -x /opt/whisper/whisper-cli ]; then
  mkdir -p /opt/whisper
  rm -rf /opt/whisper/src
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp /opt/whisper/src
  cmake -S /opt/whisper/src -B /opt/whisper/src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
  cmake --build /opt/whisper/src/build -j "$(nproc)" --config Release --target whisper-cli
  cp /opt/whisper/src/build/bin/whisper-cli /opt/whisper/whisper-cli
fi
if [ ! -f /opt/whisper/ggml-base.en.bin ]; then
  bash /opt/whisper/src/models/download-ggml-model.sh base.en /opt/whisper
fi

echo "==> App user and folders"
id -u socialhub >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin socialhub
mkdir -p "$DATA/media" "$DATA/backups"
chown -R socialhub:socialhub "$DATA"

echo "==> Environment file"
if [ ! -f "$ENV_FILE" ]; then
  sed \
    -e "s#^APP_URL=.*#APP_URL=https://$DOMAIN#" \
    -e "s#^SESSION_SECRET=.*#SESSION_SECRET=$(openssl rand -hex 32)#" \
    -e "s#^TOKEN_KEY=.*#TOKEN_KEY=$(openssl rand -hex 32)#" \
    -e "s#^CRON_KEY=.*#CRON_KEY=$(openssl rand -hex 16)#" \
    -e "s#^SETUP_KEY=.*#SETUP_KEY=$(openssl rand -hex 12)#" \
    "$APP_DIR/.env.example" > "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  chown root:socialhub "$ENV_FILE"
  echo "    Wrote $ENV_FILE — add the API keys there later (see GOING-LIVE.md)."
fi

echo "==> Build"
cd "$APP_DIR"
npm ci
npm run build
set -a; . "$ENV_FILE"; set +a
npm run migrate
npm run seed
chown -R socialhub:socialhub "$APP_DIR" "$DATA"

echo "==> Services"
sed "s#__APP_DIR__#$APP_DIR#g" deploy/social-hub.service > /etc/systemd/system/social-hub.service
sed "s#__APP_DIR__#$APP_DIR#g" deploy/social-hub-worker.service > /etc/systemd/system/social-hub-worker.service
systemctl daemon-reload
systemctl enable --now social-hub social-hub-worker

echo "==> Nginx + HTTPS"
sed "s#__DOMAIN__#$DOMAIN#g" deploy/nginx.conf > /etc/nginx/sites-available/social-hub
ln -sf /etc/nginx/sites-available/social-hub /etc/nginx/sites-enabled/social-hub
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect

echo "==> Nightly backup (03:15)"
cat > /etc/cron.d/social-hub-backup <<CRON
15 3 * * * socialhub cd $APP_DIR && set -a && . $ENV_FILE && set +a && /usr/bin/npm run backup >> $DATA/backups/backup.log 2>&1
CRON

echo
SETUP_KEY_VALUE="$(grep '^SETUP_KEY=' "$ENV_FILE" | cut -d= -f2)"
echo "Done. Create the owner account here (this link works once): https://$DOMAIN/setup?key=$SETUP_KEY_VALUE"
echo "Then add API keys to $ENV_FILE and run: systemctl restart social-hub social-hub-worker"
