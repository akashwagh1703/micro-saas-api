-- Phase 1 fix: add digest_opt_out to career_profiles
-- This column lets job seekers opt out of the daily WhatsApp digest.
ALTER TABLE "career_profiles" ADD COLUMN "digest_opt_out" BOOLEAN NOT NULL DEFAULT false;
