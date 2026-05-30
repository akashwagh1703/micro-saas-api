-- Platform billing: trial + Razorpay subscription fields on users
ALTER TABLE "users" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "subscription_status" VARCHAR(20) NOT NULL DEFAULT 'trial';
ALTER TABLE "users" ADD COLUMN "subscription_plan" VARCHAR(20);
ALTER TABLE "users" ADD COLUMN "razorpay_customer_id" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "razorpay_subscription_id" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "current_period_end" TIMESTAMP(3);

-- Existing users: 14-day trial from account creation (or from now if already older)
UPDATE "users"
SET "trial_ends_at" = COALESCE("created_at", NOW()) + INTERVAL '14 days'
WHERE "trial_ends_at" IS NULL;

ALTER TABLE "users" ALTER COLUMN "trial_ends_at" SET NOT NULL;
