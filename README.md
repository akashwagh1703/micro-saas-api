# AutoWave API

NestJS backend for AutoWave — WhatsApp/Instagram automation, workflows, CRM, billing, and marketing lead capture.

**Live:** https://api.autowave.playltp.in

## Requirements

- Node.js 18+
- PostgreSQL 14+
- (Production) Always-on process for `QUEUE_DRIVER=pgboss`

## Quick start

```bash
cp .env.example .env
# Edit .env — at minimum: DATABASE_URL, APP_ENCRYPTION_KEY

npm install
npx prisma migrate dev
npm run start:dev
```

| Endpoint | Purpose |
|----------|---------|
| `GET /up` | Liveness |
| `GET /up/ready` | Readiness (DB check) |
| `GET /up/metrics` | Process metrics (requires `X-Metrics-Token` in production) |
| `GET /api/website/config` | Public website config (pricing, industries) |
| `POST /api/website/leads/capture-demo` | Marketing demo form (rate-limited) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Dev server with watch |
| `npm run build` | Production build → `dist/` |
| `npm run start:prod` | Run built app |
| `npm run prisma:migrate` | Create/apply migrations (dev) |
| `npm run prisma:deploy` | Apply migrations (production) |
| `npm test` | Unit tests (node:test) |

## Environment variables

Copy `.env.example` and configure:

**Core**

- `DATABASE_URL`, `DIRECT_URL` — PostgreSQL
- `APP_ENCRYPTION_KEY` — 32-byte key for secret encryption
- `APP_URL` — Public API URL (webhooks, signed links)
- `CORS_ORIGINS` — Comma-separated allowed origins (portal + website)
- `WEBSITE_URL`, `PORTAL_URL` — Used in emails and config endpoint

**Email (demo leads)**

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `SALES_EMAIL` — Internal lead notification recipient

**Security & limits**

- `SUPER_ADMIN_EMAILS` — Platform admin emails
- `METRICS_TOKEN` — Required in production for `/up/metrics`
- `RATE_LIMIT_WEBSITE_LEAD_MAX` — Demo capture limit per IP (default 5/min)
- `ALLOW_UNVERIFIED_WEBHOOKS=false` — Must stay false in production

**Billing**

- `BILLING_ENABLED`, `BILLING_TRIAL_DAYS`, `PLATFORM_PRICE_*_INR`
- `RAZORPAY_*` — Subscription plans and webhook secret

See `.env.example` for CareerAI, MinIO, and job API keys.

## Database migrations

```bash
# Development
npx prisma migrate dev

# Production
npx prisma migrate deploy
```

Recent platform migrations:

- `20260701120000_website_lead_scoring` — `score`, `qualification`, `notes` on `website_leads`
- `20260701130000_user_workflow_state_tenant_scope` — tenant-scoped workflow state

## Project structure

```
src/
├── modules/
│   ├── website/       Marketing lead capture & admin (super-admin only)
│   ├── webhooks/      WhatsApp/Instagram/Meta webhooks
│   ├── workflows/     Workflow engine + interactive messages
│   ├── leads/         Tenant CRM leads
│   ├── billing/       Razorpay subscriptions
│   └── career/        CareerAI vertical plugin
├── common/            Shared utils (CSV export, phone normalize, rate limit)
└── prisma/            Schema and migrations
```

## Production deploy

```bash
npm ci
npm run build
npx prisma migrate deploy
npm run start:prod
```

Ensure `QUEUE_DRIVER=pgboss` and the worker process stays running.

## Additional docs

- [docs/CAREER_AI_SETUP.md](docs/CAREER_AI_SETUP.md)
- [docs/INSTAGRAM_SETUP.md](docs/INSTAGRAM_SETUP.md)
- [docs/DIGITALOCEAN_CICD.md](docs/DIGITALOCEAN_CICD.md)
