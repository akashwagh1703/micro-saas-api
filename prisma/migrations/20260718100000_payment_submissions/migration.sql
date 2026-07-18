-- UPI manual payment submissions + widen subscription_status for pending_verification
ALTER TABLE "users" ALTER COLUMN "subscription_status" TYPE VARCHAR(32);

CREATE TABLE "payment_submissions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "product" VARCHAR(32) NOT NULL DEFAULT 'platform',
    "plan" VARCHAR(20) NOT NULL,
    "amount_inr" INTEGER NOT NULL,
    "payment_method" VARCHAR(32) NOT NULL DEFAULT 'upi_manual',
    "upi_transaction_id" VARCHAR(64) NOT NULL,
    "screenshot_token" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "rejection_reason" VARCHAR(500),
    "reviewed_by_admin_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_submissions_user_id_status_idx" ON "payment_submissions"("user_id", "status");
CREATE INDEX "payment_submissions_status_created_at_idx" ON "payment_submissions"("status", "created_at");
CREATE INDEX "payment_submissions_upi_transaction_id_idx" ON "payment_submissions"("upi_transaction_id");

ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
