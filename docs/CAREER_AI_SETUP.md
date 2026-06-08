# CareerAI Bot — setup guide

CareerAI is a **business type** inside AutoWave (`career_ai`), not a separate app. It reuses WhatsApp, AI, queues, auth, and the portal.

## Enable for a tenant

1. **Business wizard** → select **CareerAI Bot** → finish setup (seeds sample jobs).
2. Or set `business_category` to `career_ai` in settings and `POST /api/career/setup`.
3. Connect **WhatsApp** in Settings (required for job seekers).
4. Configure **AI keys** in Settings (resume parsing, resume/cover letter generation).

## Job seeker flow (WhatsApp)

1. User messages your WhatsApp number.
2. Bot: “Upload your latest resume (PDF or DOCX).”
3. Resume → stored in MinIO (or local disk) → text extracted → AI profile created.
4. Follow-up questions: location, salary, notice period, roles.
5. Profile complete → numbered job list + daily digest.

## WhatsApp commands (P0 complete)

| Command | Action |
|---------|--------|
| VIEW JOBS | Top 10 matches (numbered) |
| FIND JOBS {keyword} | Search and rank jobs |
| APPLY 2 | Save job #2 + send apply link |
| RESUME 2 | Tailored CV for job #2 (sent on WhatsApp) |
| UPLOAD RESUME | Upload a new PDF/DOCX after onboarding |
| SHOW APPLICATIONS | Application tracker |
| GENERATE COVER LETTER | Role-specific letter |
| CAREER ADVICE {question} | AI coach |
| PREPARE INTERVIEW | Interview prep tips |
| STOP DIGEST | Opt out of daily digest |
| START DIGEST | Re-enable digest |
| RESET PROFILE | Clear profile & start onboarding again |
| DELETE MY DATA | Permanently erase profile, resumes & applications |
| ENABLE AUTO APPLY | Queue APPLY actions for operator-assisted submission |
| DISABLE AUTO APPLY | Turn off assisted auto-apply |
| SALARY BENCHMARK | AI market salary range for your role |
| SCHEDULE INTERVIEW {when} | Save preferred interview slot |
| HELP | Examples and quick commands |

## Admin (portal)

**CareerAI** in the sidebar:

- Overview analytics + **MinIO storage status**
- Profiles (download uploaded + generated resumes)
- Jobs, matches, applications
- Seed sample jobs / fetch Adzuna jobs / refresh
- Run daily digest manually

## API (`/api/career/*`, Bearer auth)

- `GET /career/storage/status` — MinIO/local storage health
- `GET /career/analytics`
- `GET /career/profiles`, `GET /career/profiles/:id`, `PATCH /career/profiles/:id`
- `GET /career/cover-letters`, `GET /career/ai-usage`, `GET /career/audit-log`
- `GET /career/job-sources` — Adzuna / Naukri / LinkedIn connection status
- `DELETE /career/profiles/:id` — permanent erasure (operator)
- `GET /career/resumes/:id/download`
- `GET /career/resume-versions/:id/download`
- `GET|POST /career/jobs`, `POST /career/jobs/refresh` (tenant-scoped)
- `GET /career/matches`, `GET /career/applications`
- `PATCH /career/applications/:id/status`
- `POST /career/digest/run`
- `POST /career/setup`

## Environment

```env
CAREER_STORAGE_PATH=./storage/career
CAREER_DIGEST_ENABLED=true
CAREER_DIGEST_TIMEZONE=Asia/Kolkata
CAREER_DIGEST_HOUR=8
CAREER_DIGEST_HOUR_UTC=8
CAREER_RATE_LIMIT_PER_MINUTE=20
CAREER_AI_MONTHLY_TOKEN_LIMIT=0
CAREER_RESUME_TEXT_RETENTION_DAYS=365

# Queue driver (recommended for production / multi-instance)
QUEUE_DRIVER=pgboss

# Adzuna (optional — real jobs)
ADZUNA_APP_ID=
ADZUNA_APP_KEY=

# MinIO (recommended for production)
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_FORCE_PATH_STYLE=true
MINIO_BUCKET=autowave-career-resumes
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_REGION=us-east-1
```

**Important:** `MINIO_ENDPOINT` must use port **9000** (S3 API). Port **9001** is the web console only.

## MinIO on your server (Docker)

```bash
docker run -d \
  --name minio \
  --restart unless-stopped \
  -p 127.0.0.1:9000:9000 \
  -p 127.0.0.1:9001:9001 \
  -v /data/minio:/data \
  -e MINIO_ROOT_USER=your-access-key \
  -e MINIO_ROOT_PASSWORD=your-strong-secret \
  minio/minio server /data --console-address ":9001"
```

Set API `.env`:

```env
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-strong-secret
MINIO_BUCKET=autowave-career-resumes
```

The API auto-creates the bucket on startup if it does not exist.

## P0 production deploy checklist

Run on the API server before going live:

```bash
cd micro-saas-api
npm ci
npx prisma migrate deploy
npm run build
# restart API (pm2, systemd, or docker)
```

Verify:

1. `GET /api/career/storage/status` → `{ "backend": "object", "ok": true }`
2. Portal CareerAI page shows green MinIO status
3. Upload a test resume on WhatsApp → download works in portal
4. `VIEW JOBS` → numbered list with apply URLs
5. `RESUME 1` → tailored text arrives on WhatsApp
6. `POST /career/digest/run` twice same day → second run skips (dedup)

## P1 — Job seeker UX (shipped)

- **WhatsApp reply buttons** for work mode (Remote / Hybrid / Onsite) and top job actions (Apply #1–3, Resume #1)
- **`RESET PROFILE` / `START OVER`** — clears profile and restarts onboarding
- **`HELP`** with practical examples (not a raw command wall)
- **IST digest** — `CAREER_DIGEST_TIMEZONE=Asia/Kolkata` + `CAREER_DIGEST_HOUR=8` (8:00 AM local)
- **Re-upload** — `UPLOAD RESUME` re-parses with AI and re-runs job matching
- **Smarter parse** — AI extracts location, salary, notice period, roles from resume when present (skips manual questions)

## P2 — Operator & scale (shipped)

### Async background tasks (pg-boss)
Heavy CareerAI work runs off the WhatsApp webhook path so users get an immediate reply:

- Resume parse after upload
- `GENERATE RESUME` / `RESUME N`
- `GENERATE COVER LETTER`

Users see “⏳ working…” on WhatsApp; the bot sends the result when the queue job finishes.

### Distributed cron (multi-instance safe)
When `QUEUE_DRIVER=pgboss` (default):

- Daily digest and Adzuna job refresh are scheduled via **pg-boss** (`CareerPgBossScheduler`)
- In-process `node-cron` / `setInterval` schedulers are skipped (no duplicate runs across pods)

Check API logs on startup for:

```
pg-boss digest scheduled: 0 8 * * * (Asia/Kolkata)
pg-boss job refresh scheduled: every 6 hours (UTC)
```

### AI usage metering
- Monthly token totals stored per tenant in `user_settings` (`career_ai_usage`)
- Portal overview shows **AI tokens (this month)**
- `GET /career/ai-usage` for detailed stats
- Set `CAREER_AI_MONTHLY_TOKEN_LIMIT` to cap usage (0 = unlimited)

### Portal operator upgrades
- **CareerAI nav** visible only when `business_category === career_ai`
- Non–CareerAI tenants are redirected away from `/career-ai`
- **Profile detail modal** — edit location, salary, roles; view cover letters and generated resumes
- **Download** uploaded and tailored resumes from profile detail

## P2 production deploy checklist

```bash
cd micro-saas-api
npm ci
npx prisma migrate deploy
npm run build
# restart API

cd ../micro-saas-portal
npm run build
# deploy dist/
```

Verify:

1. Upload resume on WhatsApp → immediate ack → profile completes in background
2. `RESUME 1` → “Generating…” then tailored resume arrives within ~30s
3. Portal overview shows AI token count
4. Edit a profile field in portal → saves via `PATCH /career/profiles/:id`
5. Two API instances → digest runs once (check logs / notification dedup)

## P3 — Trust & compliance (shipped)

### Data deletion
- **`DELETE MY DATA`** on WhatsApp — job seeker permanently erases their profile
- **`DELETE /career/profiles/:id`** — operator deletes from portal (profile modal)
- Removes DB records **and** resume/cover letter files from MinIO/local storage
- Audit log entry recorded before deletion

### Resume text retention
- `CAREER_RESUME_TEXT_RETENTION_DAYS=365` (set `0` to disable)
- Nightly job clears `extracted_text` / generated content from DB after the retention window
- Original files in MinIO remain for download unless profile is deleted

### Audit log
- Application status changes from portal are logged (`application_status_changed`)
- Profile deletions and retention purges are logged
- Portal **Audit log** tab + `GET /career/audit-log`

### Privacy documentation
- Portal and website privacy policies include a **CareerAI / job seeker data** section
- Operators are responsible for informing job seekers how their resume data is processed

## P3 production deploy checklist

```bash
cd micro-saas-api
npm ci
npx prisma migrate deploy
npm run build
# restart API

cd ../micro-saas-portal
npm run build
```

Verify:

1. Change application status in portal → event appears in Audit log tab
2. Delete profile from portal → profile gone, audit entry created
3. Job seeker sends `DELETE MY DATA` on WhatsApp → confirmation + fresh start on next message
4. API logs show `pg-boss resume text retention scheduled` when retention days &gt; 0

## P4 — Growth features (shipped)

### Multi-source job fetching (`CareerJobSource`)
- **Adzuna** — live when `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` are set (unchanged)
- **Naukri** — enable with `NAUKRI_JOBS_API_URL` + `NAUKRI_JOBS_API_KEY` (your JSON feed/scraper)
- **LinkedIn** — enable with `LINKEDIN_JOBS_API_URL` + `LINKEDIN_JOBS_API_KEY` (partner feed)
- Portal **Jobs** tab shows each source status; fetch runs all connected sources

### Assisted auto-apply (consent-based)
- Job seeker: `ENABLE AUTO APPLY` / `DISABLE AUTO APPLY` on WhatsApp
- Operator: toggle in profile edit form (portal)
- When consent is on, `APPLY N` saves status `auto_apply_queued` for operator follow-up (not fully automated browser apply)

### OCR resume uploads
- Accept **JPEG/PNG photo** resumes on WhatsApp (tesseract.js)
- Scanned PDFs (no extractable text) get a clear error asking for photos or text-based PDF
- `CAREER_OCR_ENABLED=false` disables OCR

### Salary benchmark & interview scheduling
- `SALARY BENCHMARK` — AI market range using profile roles/location
- `SCHEDULE INTERVIEW Monday 3pm` — saves slot in profile; visible in portal

## P4 production deploy checklist

```bash
cd micro-saas-api
npm ci
npx prisma migrate deploy
npm run build
# restart API

cd ../micro-saas-portal
npm run build
```

Verify:

1. Portal Jobs tab shows Adzuna connected (if keys set)
2. Send a resume **photo** on WhatsApp → profile parses via OCR
3. `ENABLE AUTO APPLY` then `APPLY 1` → application status `auto_apply_queued` in portal
4. `SALARY BENCHMARK` returns a salary range on WhatsApp

## Database tables

`career_profiles`, `career_resumes`, `career_resume_versions`, `career_jobs`, `career_job_matches`, `career_applications`, `career_cover_letters`, `career_notifications`

Migrations: `20260601120000_career_ai_module` through `20260608150000_career_p4_growth`

## Future modules (placeholders)

Browser extension, full browser auto-apply, ATS deep integration, interview AI agent — extend via new services under `modules/career/` without changing core tenancy.
