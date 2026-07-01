#!/usr/bin/env bash
# Run ON THE SERVER: bash scripts/diagnose-server.sh
set -uo pipefail

APP_DIR="${APP_DIR:-/var/www/autowave/micro-saas-api}"
cd "$APP_DIR"

echo "========== AutoWave API diagnose =========="
echo "Time: $(date -Is)"
echo "Host: $(hostname)"
echo ""

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
PORT="${PORT:-3000}"

echo "==> .env (non-secret keys)"
grep -E '^(NODE_ENV|PORT|QUEUE_DRIVER|APP_URL|CORS_ORIGINS|PORTAL_URL|WEBSITE_URL|APP_ENCRYPTION_KEY)=' .env 2>/dev/null | sed 's/APP_ENCRYPTION_KEY=.*/APP_ENCRYPTION_KEY=***set***/' || echo "MISSING .env"
echo ""

echo "==> dist/main.js"
if [[ -f dist/main.js ]]; then
  echo "OK ($(wc -c < dist/main.js) bytes)"
else
  echo "MISSING — run: npm run build"
fi
echo ""

echo "==> PM2"
pm2 describe autowave-api 2>/dev/null | grep -E 'status|restarts|uptime|script path|exec cwd' || echo "autowave-api not in PM2"
echo ""

echo "==> Port $PORT listening?"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp | grep ":${PORT} " || echo "NOT listening on $PORT"
else
  netstat -tlnp 2>/dev/null | grep ":${PORT} " || echo "NOT listening on $PORT"
fi
echo ""

echo "==> Local health"
curl -sS -m 5 "http://127.0.0.1:${PORT}/up" && echo "" || echo "FAIL /up"
curl -sS -m 5 "http://127.0.0.1:${PORT}/up/ready" && echo "" || echo "FAIL /up/ready"
echo ""

echo "==> Local CORS preflight (portal)"
curl -sSI -m 5 -X OPTIONS "http://127.0.0.1:${PORT}/api/auth/login" \
  -H "Origin: https://app.autowave.playltp.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | grep -iE 'HTTP/|access-control' || echo "FAIL preflight"
echo ""

echo "==> Local CORS preflight (marketing website)"
curl -sSI -m 5 -X OPTIONS "http://127.0.0.1:${PORT}/api/website/leads/capture-demo" \
  -H "Origin: https://autowave.playltp.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | grep -iE 'HTTP/|access-control' || echo "FAIL preflight — add autowave.playltp.in to CORS_ORIGINS and restart"
echo ""

echo "==> Website demo route"
curl -sS -m 5 -o /dev/null -w "POST /api/website/leads/capture-demo HTTP:%{http_code}\n" \
  -X POST "http://127.0.0.1:${PORT}/api/website/leads/capture-demo" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","phone":"+919876543210","businessType":"General Business","companyName":"Test","source":"website"}' \
  || echo "FAIL capture-demo (404 = old code not deployed)"
echo ""

echo "==> PM2 logs (last 40 lines)"
pm2 logs autowave-api --lines 40 --nostream 2>/dev/null || true
echo ""

echo "==> Public URL (via nginx)"
curl -sS -m 5 -o /dev/null -w "api.autowave.playltp.in/up HTTP:%{http_code}\n" "https://api.autowave.playltp.in/up" || echo "public /up FAIL"
echo ""
echo "If still failing, run foreground start to see the exact error:"
echo "  bash scripts/start-foreground.sh"
echo ""
echo "Browser 'CORS error' on login = API not responding (502), not portal bug"
