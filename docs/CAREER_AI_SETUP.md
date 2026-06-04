# CareerAI Bot — setup guide

CareerAI is a **business type** inside WhatsFlow (`career_ai`), not a separate app. It reuses WhatsApp, AI, queues, auth, and the portal.

## Enable for a tenant

1. **Business wizard** → select **CareerAI Bot** → finish setup (seeds sample jobs).
2. Or set `business_category` to `career_ai` in settings and `POST /api/career/setup`.
3. Connect **WhatsApp** in Settings (required for job seekers).
4. Configure **AI keys** in Settings (resume parsing, resume/cover letter generation).

## Job seeker flow (WhatsApp)

1. User messages your WhatsApp number.
2. Bot: “Upload your latest resume (PDF or DOCX).”
3. Resume → stored → text extracted → AI profile created.
4. Follow-up questions: location, salary, notice period, roles.
5. Profile complete → job matching + daily digest.

## WhatsApp commands

| Command | Action |
|---------|--------|
| FIND JOBS {keyword} | Search and rank jobs |
| VIEW JOBS | Top matches |
| SHOW APPLICATIONS | Application tracker |
| GENERATE RESUME | Tailored resume for top match |
| GENERATE COVER LETTER | Role-specific letter |
| CAREER ADVICE {question} | AI coach |
| PREPARE INTERVIEW | Interview prep tips |

## Admin (portal)

**CareerAI** in the sidebar:

- Overview analytics
- Profiles, jobs, matches, applications
- Seed sample jobs
- Run daily digest manually

## API (`/api/career/*`, Bearer auth)

- `GET /career/analytics`
- `GET /career/profiles`, `GET /career/profiles/:id`
- `GET|POST /career/jobs`, `POST /career/jobs/seed`
- `GET /career/matches`, `GET /career/applications`
- `PATCH /career/applications/:id/status`
- `POST /career/digest/run`
- `POST /career/setup`

## Database tables

`career_profiles`, `career_resumes`, `career_resume_versions`, `career_jobs`, `career_job_matches`, `career_applications`, `career_cover_letters`, `career_notifications`

Migration: `20260601120000_career_ai_module`

## Environment

```env
CAREER_STORAGE_PATH=./storage/career
CAREER_DIGEST_ENABLED=true
CAREER_DIGEST_HOUR_UTC=8
```

## Future modules (placeholders only in V1)

Browser extension, ATS integration, auto-apply, LinkedIn, Naukri, interview AI agent, salary predictor, career coach — extend via new services under `modules/career/` without changing core tenancy.
