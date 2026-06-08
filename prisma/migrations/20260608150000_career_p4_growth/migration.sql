-- P4: auto-apply consent + interview scheduling preferences
ALTER TABLE "career_profiles" ADD COLUMN "auto_apply_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "career_profiles" ADD COLUMN "auto_apply_consent_at" TIMESTAMP(3);
ALTER TABLE "career_profiles" ADD COLUMN "interview_preferences" JSONB;
