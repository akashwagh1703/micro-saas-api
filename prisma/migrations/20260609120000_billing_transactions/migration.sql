-- Platform billing transaction history for admin dashboard
CREATE TABLE "billing_transactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "product" VARCHAR(32) NOT NULL DEFAULT 'platform',
    "event_type" VARCHAR(64) NOT NULL,
    "razorpay_payment_id" VARCHAR(64),
    "razorpay_subscription_id" VARCHAR(64),
    "plan" VARCHAR(20),
    "amount_inr" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(32) NOT NULL DEFAULT 'captured',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_transactions_user_id_created_at_idx" ON "billing_transactions"("user_id", "created_at");
CREATE INDEX "billing_transactions_created_at_idx" ON "billing_transactions"("created_at");
CREATE INDEX "billing_transactions_product_created_at_idx" ON "billing_transactions"("product", "created_at");
CREATE INDEX "billing_transactions_razorpay_payment_id_idx" ON "billing_transactions"("razorpay_payment_id");

ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
