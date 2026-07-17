# Fix demo form: "Database schema is out of date"

The marketing form writes to PostgreSQL table **`website_leads`**. If migrations did not run on production, you see a 500 error with that message.

## Render (recommended)

1. Open **Render Dashboard** → your **micro-saas-api** service.
2. **Environment**: ensure `DATABASE_URL` is set. If you use Neon pooler, also set **`DIRECT_URL`** to the **non-pooled** Postgres URL (migrations need a direct connection).
3. Open **Shell** (same service) and run:

```bash
cd ~/project/src   # or your API root if different; use `pwd` after SSH/shell opens
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
npx prisma migrate deploy
npm run repair:website-leads
```

4. **Manual Deploy** → **Clear build cache & deploy** (or push latest code so `render-start.sh` runs migrate + repair on boot).

5. Verify:

```bash
curl -s https://api.autowave.playltp.in/api/website/health/demo-capture
```

Expect: `{"ok":true,"message":"Demo capture is ready."}`

## DigitalOcean / VPS

```bash
cd /var/www/autowave/micro-saas-api   # adjust path
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
npx prisma migrate deploy
npm run repair:website-leads
pm2 restart autowave-api
```

Or run the full script:

```bash
bash scripts/fix-website-demo.sh
```

## If `migrate deploy` fails

- Read the error (failed migration name, permission denied, connection).
- Common fix: set **`DIRECT_URL`** to the primary Postgres host, not the pooler.
- Then run `npm run repair:website-leads` anyway — it creates/fixes **only** `website_leads` safely.

## After fix

Submit the website demo form with a **new email** and a **10-digit Indian mobile** (e.g. `9876543210`).
