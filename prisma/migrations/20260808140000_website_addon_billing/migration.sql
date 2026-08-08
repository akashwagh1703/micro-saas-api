-- Website add-on billing (brochure publish) — independent of platform subscription
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "website_subscription_status" VARCHAR(32) NOT NULL DEFAULT 'none';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "website_subscription_plan" VARCHAR(20);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "website_current_period_end" TIMESTAMP(3);
