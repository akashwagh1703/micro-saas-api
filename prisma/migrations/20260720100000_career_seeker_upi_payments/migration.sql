-- CareerAI seeker UPI manual payments (Phase 6)
ALTER TABLE "career_profiles" ALTER COLUMN "subscription_status" SET DATA TYPE VARCHAR(32);

ALTER TABLE "payment_submissions" ADD COLUMN IF NOT EXISTS "profile_id" INTEGER;

CREATE INDEX IF NOT EXISTS "payment_submissions_product_profile_id_status_idx"
  ON "payment_submissions"("product", "profile_id", "status");

ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
