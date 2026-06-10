-- Phase 4: match feedback & learning loop
CREATE TABLE "career_match_feedback" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "job_id" INTEGER NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_match_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_match_feedback_profile_id_event_created_at_idx" ON "career_match_feedback"("profile_id", "event", "created_at");
CREATE INDEX "career_match_feedback_profile_id_job_id_idx" ON "career_match_feedback"("profile_id", "job_id");

ALTER TABLE "career_match_feedback" ADD CONSTRAINT "career_match_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_match_feedback" ADD CONSTRAINT "career_match_feedback_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_match_feedback" ADD CONSTRAINT "career_match_feedback_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "career_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
