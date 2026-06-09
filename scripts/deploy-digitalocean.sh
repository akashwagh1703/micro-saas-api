#!/usr/bin/env bash
# Run ON THE SERVER after git pull (or called by GitHub Actions over SSH).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
BRANCH="${DEPLOY_BRANCH:-master}"
PM2_NAME="${PM2_NAME:-autowave-api}"

cd "$APP_DIR"

echo "==> Deploy API in $APP_DIR (branch $BRANCH)"

if [[ ! -f .env ]]; then
  echo "ERROR: $APP_DIR/.env missing — create it on the server (never commit secrets)."
  exit 1
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> npm ci"
npm ci

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> build"
npm run build

echo "==> pm2 restart $PM2_NAME"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start dist/main.js --name "$PM2_NAME"
fi

pm2 save

echo "==> health check"
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-3000}/up/ready" >/dev/null || {
  echo "WARN: /up/ready check failed — inspect: pm2 logs $PM2_NAME --lines 50"
  exit 1
}

echo "==> API deploy OK"
