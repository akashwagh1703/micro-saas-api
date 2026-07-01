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
rm -rf dist
npm run build
npx prisma migrate deploy

if [[ ! -f dist/main.js ]]; then
  if [[ -f dist/src/main.js ]]; then
    echo "WARN: dist/main.js missing — using legacy dist/src/main.js (push latest tsconfig.build.json)"
  else
    echo "ERROR: build failed — no dist/main.js or dist/src/main.js. Run: npm run build 2>&1 | tail -50"
    exit 1
  fi
fi

if [[ -f dist/app.module.js ]] && ! grep -q 'website' dist/app.module.js 2>/dev/null; then
  if [[ -f dist/src/app.module.js ]] && grep -q 'website' dist/src/app.module.js 2>/dev/null; then
    echo "WARN: WebsiteModule in dist/src/ only — legacy build layout"
  else
    echo "ERROR: WebsiteModule not found in build output"
    exit 1
  fi
fi

echo "==> Build OK"

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
PORT="${PORT:-3000}"

echo "==> Restart API via scripts/api-entry.cjs"
pm2 delete autowave-api 2>/dev/null || true
pm2 start ecosystem.config.cjs --update-env
pm2 save
sleep 5

if ! curl -fsS "http://127.0.0.1:${PORT:-3000}/up" >/dev/null 2>&1; then
  echo "ERROR: API not responding — last PM2 logs:"
  pm2 logs autowave-api --lines 40 --nostream || true
  exit 1
fi

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
