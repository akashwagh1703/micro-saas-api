-- CareerJob fields from enhancement plan Phase 2/3
ALTER TABLE "career_jobs" ADD COLUMN "experience_max" INTEGER;
ALTER TABLE "career_jobs" ADD COLUMN "tags" JSONB;
