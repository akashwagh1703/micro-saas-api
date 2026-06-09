#!/usr/bin/env bash
# Stop PM2 and run API in foreground to see the REAL crash error.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
cd "$APP_DIR"

pm2 delete autowave-api 2>/dev/null || true

if [[ ! -f dist/main.js ]]; then
  echo "dist/main.js missing — run: npm run build"
  exit 1
fi

echo "Starting node dist/main.js in foreground (Ctrl+C to stop)…"
echo "---"
set -a
# shellcheck disable=SC1091
source .env
set +a
exec node dist/main.js
