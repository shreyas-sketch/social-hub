#!/usr/bin/env bash
# Railway start: migrate, seed once, then run the web app and the worker together.
# If either stops, the container exits and Railway restarts it.
set -uo pipefail
cd "$(dirname "$0")/../.."

DATA_DIR="${DATA_DIR:-/data}"
export WHISPER_MODEL="${WHISPER_MODEL:-$(ls /opt/whisper/ggml-*.bin 2>/dev/null | head -1)}"

for v in SESSION_SECRET TOKEN_KEY; do
  if [ -z "${!v:-}" ]; then echo "!! $v is not set — add it in Railway → Variables. Not starting." >&2; exit 1; fi
done
for v in SETUP_KEY APP_URL; do
  if [ -z "${!v:-}" ]; then echo "!! $v is not set — add it in Railway → Variables." >&2; fi
done
# On Railway, without a volume the database and videos would be wiped on every deploy.
if [ -n "${RAILWAY_ENVIRONMENT:-}" ] && [ -z "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  echo "!! No volume attached. Add a Railway volume mounted at $DATA_DIR, then redeploy. Not starting." >&2; exit 1
fi
if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH%/}" != "${DATA_DIR%/}" ]; then
  echo "!! The volume is mounted at $RAILWAY_VOLUME_MOUNT_PATH but the app keeps its data in $DATA_DIR. Mount it at $DATA_DIR. Not starting." >&2; exit 1
fi
mkdir -p "$DATA_DIR/media" "$DATA_DIR/backups" || exit 1

npm run migrate || exit 1
# Seed only on the very first boot, so creators removed later aren't added back on every deploy.
if [ ! -f "$DATA_DIR/.seeded" ]; then
  npm run seed && touch "$DATA_DIR/.seeded"
fi

# Nightly database copy onto the volume (keeps 14). Videos aren't included.
( while true; do sleep 86400; npm run --silent backup || true; done ) &
BACKUP=$!

# Started directly (not through npm/npx) so a stop signal reaches the real processes.
node --import tsx worker/index.ts &
WORKER=$!
node node_modules/next/dist/bin/next start -p "${PORT:-3100}" -H 0.0.0.0 &
WEB=$!

stop() { kill -TERM "$WORKER" "$WEB" "$BACKUP" 2>/dev/null; wait "$WORKER" "$WEB" 2>/dev/null; }
trap 'stop; exit 0' TERM INT
wait -n "$WORKER" "$WEB"
echo "!! a process stopped — exiting so Railway restarts the service" >&2
stop
exit 1
