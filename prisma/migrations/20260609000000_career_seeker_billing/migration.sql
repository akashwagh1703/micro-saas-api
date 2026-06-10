-- Job seeker (candidate) subscription billing on career_profiles
ALTER TABLE "career_profiles" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "career_profiles" ADD COLUMN "subscription_status" VARCHAR(20) NOT NULL DEFAULT 'trial';
ALTER TABLE "career_profiles" ADD COLUMN "subscription_plan" VARCHAR(20);
ALTER TABLE "career_profiles" ADD COLUMN "razorpay_customer_id" VARCHAR(64);
ALTER TABLE "career_profiles" ADD COLUMN "razorpay_subscription_id" VARCHAR(64);
ALTER TABLE "career_profiles" ADD COLUMN "current_period_end" TIMESTAMP(3);

-- Backfill trial for existing profiles (14 days from now)
UPDATE "career_profiles"
SET "trial_ends_at" = NOW() + INTERVAL '14 days'
WHERE "trial_ends_at" IS NULL;

ALTER TABLE "career_profiles" ALTER COLUMN "trial_ends_at" SET NOT NULL;

CREATE INDEX "career_profiles_razorpay_subscription_id_idx"
  ON "career_profiles"("razorpay_subscription_id");
