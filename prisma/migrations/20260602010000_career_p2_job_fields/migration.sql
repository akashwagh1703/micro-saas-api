-- Phase 2: real job data pipeline — new columns on career_jobs
ALTER TABLE "career_jobs"
  ADD COLUMN IF NOT EXISTS "posted_at"  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "city"       VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "industry"   VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "apply_url"  TEXT;

-- Unique constraint used by upsert in CareerJobFetcherService.
-- Only add when external_id is non-null to avoid conflicting with existing seed rows.
CREATE UNIQUE INDEX IF NOT EXISTS "career_jobs_user_id_external_id_key"
  ON "career_jobs" ("user_id", "external_id")
  WHERE "external_id" IS NOT NULL;
