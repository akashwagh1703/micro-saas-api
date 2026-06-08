-- P3: CareerAI audit log for operator actions and compliance events
CREATE TABLE "career_audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER,
    "application_id" INTEGER,
    "action" VARCHAR(60) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_label" VARCHAR(120),
    "details" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_audit_logs_user_id_created_at_idx" ON "career_audit_logs"("user_id", "created_at");
CREATE INDEX "career_audit_logs_user_id_action_idx" ON "career_audit_logs"("user_id", "action");

ALTER TABLE "career_audit_logs" ADD CONSTRAINT "career_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
