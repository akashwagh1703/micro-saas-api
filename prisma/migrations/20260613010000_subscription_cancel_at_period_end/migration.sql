-- Track "cancel at period end" so a cancelled subscription keeps access until the
-- paid period ends (grace period) instead of losing access immediately.

ALTER TABLE "users"
  ADD COLUMN "subscription_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "career_profiles"
  ADD COLUMN "subscription_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
