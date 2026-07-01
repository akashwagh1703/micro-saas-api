#!/usr/bin/env bash
# One-shot recovery when PM2 shows: Cannot find module '.../dist/main.js'
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
PM2_NAME="${PM2_NAME:-autowave-api}"
cd "$APP_DIR"

echo "==> Recover API in $APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing in $APP_DIR"
  exit 1
fi

# Export PORT for health checks (Nest reads .env at runtime; shell does not)
if grep -q '^PORT=' .env; then
  PORT="$(grep '^PORT=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
  export PORT
fi
PORT="${PORT:-3000}"

echo "==> Stop PM2 before build (prevents dist/ delete race)"
pm2 delete "$PM2_NAME" 2>/dev/null || true

echo "==> npm ci"
npm ci

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> npm run build (clean dist first)"
rm -rf dist
npm run build

if [[ ! -f dist/main.js ]] && [[ ! -f dist/src/main.js ]]; then
  echo "ERROR: build failed — no dist/main.js or dist/src/main.js. Run: npm run build 2>&1 | tail -50"
  exit 1
fi

if [[ -f dist/main.js ]]; then
  echo "==> dist/main.js OK ($(wc -c < dist/main.js) bytes)"
elif [[ -f dist/src/main.js ]]; then
  echo "==> dist/src/main.js OK ($(wc -c < dist/src/main.js) bytes) — push tsconfig.build.json fix for dist/main.js"
fi

pm2 start ecosystem.config.cjs --update-env
pm2 save

echo "==> waiting for API on port $PORT (up to 30s)..."
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS "http://127.0.0.1:${PORT}/up/ready" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -eq 1 ]]; then
  curl -fsS "http://127.0.0.1:${PORT}/up/ready"
  echo ""
  echo "==> API is ready on port $PORT"
  exit 0
fi

echo ""
echo "ERROR: API did not respond on port $PORT."
echo "==> pm2 status"
pm2 status "$PM2_NAME" || true
echo ""
echo "==> pm2 logs (last 60 lines)"
pm2 logs "$PM2_NAME" --lines 60 --nostream || true
echo ""
echo "Common fixes — check .env on the server:"
echo "  NODE_ENV=production"
echo "  QUEUE_DRIVER=pgboss"
echo "  APP_ENCRYPTION_KEY=<32-byte key>"
echo "  APP_URL=https://api.autowave.playltp.in"
echo "  CORS_ORIGINS=https://app.autowave.playltp.in"
exit 1
