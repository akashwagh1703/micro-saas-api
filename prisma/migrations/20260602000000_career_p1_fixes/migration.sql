-- Phase 1 fixes: add digest_opt_out column to career_profiles
ALTER TABLE "career_profiles" ADD COLUMN "digest_opt_out" BOOLEAN NOT NULL DEFAULT false;
