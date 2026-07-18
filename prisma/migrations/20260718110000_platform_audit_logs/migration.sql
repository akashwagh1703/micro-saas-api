-- Phase 5: platform admin audit trail for UPI payment ops
CREATE TABLE "platform_audit_logs" (
    "id" SERIAL NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "actor_admin_id" INTEGER,
    "target_user_id" INTEGER,
    "payment_submission_id" INTEGER,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_logs_action_created_at_idx" ON "platform_audit_logs"("action", "created_at");
CREATE INDEX "platform_audit_logs_target_user_id_created_at_idx" ON "platform_audit_logs"("target_user_id", "created_at");

ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
