#!/usr/bin/env bash
# Run ON THE SERVER to fix demo form CORS + deploy website lead routes.
# Usage: bash scripts/fix-website-demo.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
cd "$APP_DIR"

echo "==> Pull latest API code"
git pull origin master

echo "==> Ensure CORS allows marketing website"
touch .env
grep -q '^WEBSITE_URL=' .env || echo 'WEBSITE_URL=https://autowave.playltp.in' >> .env
grep -q '^APP_URL=' .env || echo 'APP_URL=https://api.autowave.playltp.in' >> .env

# Merge marketing origins into CORS_ORIGINS if missing
if grep -q '^CORS_ORIGINS=' .env; then
  current="$(grep '^CORS_ORIGINS=' .env | cut -d= -f2-)"
  for origin in \
    'https://app.autowave.playltp.in' \
    'https://autowave.playltp.in' \
    'https://www.autowave.playltp.in'; do
    if [[ "$current" != *"$origin"* ]]; then
      current="${current},${origin}"
    fi
  done
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${current}|" .env
else
  echo 'CORS_ORIGINS=https://app.autowave.playltp.in,https://autowave.playltp.in,https://www.autowave.playltp.in' >> .env
fi

echo "==> Install, build, migrate"
npm ci
npm run build
npx prisma migrate deploy

echo "==> Restart API"
pm2 restart autowave-api || pm2 start dist/main.js --name autowave-api
sleep 3

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
PORT="${PORT:-3000}"

echo "==> Verify CORS (marketing site)"
curl -sSI -X OPTIONS "http://127.0.0.1:${PORT}/api/website/leads/capture-demo" \
  -H "Origin: https://autowave.playltp.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  | grep -iE 'HTTP/|access-control-allow-origin' || true

echo "==> Verify route exists"
curl -sS -o /dev/null -w "capture-demo HTTP:%{http_code}\n" -X POST "http://127.0.0.1:${PORT}/api/website/leads/capture-demo" \
  -H "Origin: https://autowave.playltp.in" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","phone":"+919876543210","businessType":"General Business","companyName":"Test Co","source":"website"}'

echo "Done. PM2 logs should show: Allowed origins: ...autowave.playltp.in..."
