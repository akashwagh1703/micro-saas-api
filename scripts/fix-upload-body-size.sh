#!/usr/bin/env bash
# Run ON THE API SERVER to fix logo/catalog upload 413 (looks like CORS in the browser).
# Usage: bash scripts/fix-upload-body-size.sh
set -euo pipefail

SIZE="${1:-25m}"
echo "==> Raising nginx client_max_body_size to ${SIZE} for api.autowave.playltp.in"

CONF=""
for candidate in \
  /etc/nginx/sites-enabled/autowave-api \
  /etc/nginx/sites-available/autowave-api \
  /etc/nginx/conf.d/autowave-api.conf \
  /etc/nginx/sites-enabled/default
do
  if [[ -f "$candidate" ]] && grep -qE 'api\.autowave\.playltp\.in|proxy_pass.*3000' "$candidate" 2>/dev/null; then
    CONF="$candidate"
    break
  fi
done

if [[ -z "$CONF" ]]; then
  echo "Could not find nginx site for the API. Looking for any proxy to :3000..."
  CONF="$(grep -Rsl 'proxy_pass.*3000' /etc/nginx 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$CONF" || ! -f "$CONF" ]]; then
  echo "FAIL: no nginx config found. Install deploy/nginx/autowave-api.conf first."
  exit 1
fi

echo "Using config: $CONF"
sudo cp "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"

if grep -q 'client_max_body_size' "$CONF"; then
  sudo sed -i -E "s/client_max_body_size[[:space:]]+[^;]+;/client_max_body_size ${SIZE};/g" "$CONF"
  echo "Updated existing client_max_body_size → ${SIZE}"
else
  # Insert inside the first server { } block
  sudo awk -v size="$SIZE" '
    BEGIN { done=0 }
    /server[[:space:]]*\{/ && !done {
      print
      print "    client_max_body_size " size ";"
      done=1
      next
    }
    { print }
  ' "$CONF" | sudo tee "${CONF}.tmp" >/dev/null
  sudo mv "${CONF}.tmp" "$CONF"
  echo "Inserted client_max_body_size ${SIZE}"
fi

# Also set in http{} if present and still at default-risk (optional global)
HTTP_CONF=/etc/nginx/nginx.conf
if [[ -f "$HTTP_CONF" ]] && ! grep -q 'client_max_body_size' "$HTTP_CONF"; then
  echo "Note: /etc/nginx/nginx.conf has no client_max_body_size (site-level setting above is enough)."
fi

echo "==> Testing nginx config"
sudo nginx -t

echo "==> Reloading nginx"
sudo systemctl reload nginx

echo "==> Done. Retry logo upload (JPEG/PNG/WebP under 5 MB)."
echo "    Browser 'CORS' on upload was almost always this 413 body-size limit."
