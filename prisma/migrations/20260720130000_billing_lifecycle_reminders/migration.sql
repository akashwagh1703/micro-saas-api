-- Idempotency markers for subscription expiring / expired notifications
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_expiring_notified_for" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_expired_notified_for" TIMESTAMP(3);
