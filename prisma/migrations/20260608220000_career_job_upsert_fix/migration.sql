-- Ensure columns used by Adzuna upsert exist (safe if already applied).
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "experience_max" INTEGER;
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "tags" JSONB;
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMPTZ;
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ;
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "city" VARCHAR(80);
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "industry" VARCHAR(60);
ALTER TABLE "career_jobs" ADD COLUMN IF NOT EXISTS "apply_url" TEXT;

-- Replace partial unique index with a full one (PostgreSQL allows multiple NULL external_id rows).
DROP INDEX IF EXISTS "career_jobs_user_id_external_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "career_jobs_user_id_external_id_key"
  ON "career_jobs" ("user_id", "external_id");
