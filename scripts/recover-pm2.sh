#!/usr/bin/env bash
# One-shot recovery when PM2 shows: Cannot find module '.../dist/main.js'
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
cd "$APP_DIR"

echo "==> Recover API in $APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing in $APP_DIR"
  exit 1
fi

echo "==> npm ci"
npm ci

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> npm run build"
npm run build

if [[ ! -f dist/main.js ]]; then
  echo "ERROR: build failed — dist/main.js still missing. Run: npm run build 2>&1 | tail -50"
  exit 1
fi

echo "==> dist/main.js OK ($(wc -c < dist/main.js) bytes)"

pm2 delete autowave-api 2>/dev/null || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

sleep 3
curl -fsS "http://127.0.0.1:${PORT:-3000}/up/ready" && echo "" && echo "==> API is ready"
