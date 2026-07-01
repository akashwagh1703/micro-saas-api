#!/usr/bin/env bash
# Stop PM2 and run API in foreground to see the REAL crash error.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
cd "$APP_DIR"

pm2 delete autowave-api 2>/dev/null || true

ENTRY=""
if [[ -f dist/main.js ]]; then
  ENTRY="dist/main.js"
elif [[ -f dist/src/main.js ]]; then
  ENTRY="dist/src/main.js"
fi

if [[ -z "$ENTRY" ]]; then
  echo "No API build found — run: rm -rf dist && npm run build"
  exit 1
fi

echo "Starting node $ENTRY in foreground (Ctrl+C to stop)…"
echo "---"
set -a
# shellcheck disable=SC1091
source .env
set +a
exec node "$ENTRY"
