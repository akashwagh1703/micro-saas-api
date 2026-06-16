-- Integration credential vault + workflow webhook/schedule triggers (Phase 4)

CREATE TABLE "integration_credentials" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "label" VARCHAR(128),
    "auth_type" VARCHAR(32) NOT NULL DEFAULT 'bearer',
    "secret" TEXT NOT NULL,
    "header_name" VARCHAR(64),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_credentials_user_id_name_key" ON "integration_credentials"("user_id", "name");
CREATE INDEX "integration_credentials_user_id_idx" ON "integration_credentials"("user_id");

ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflows" ADD COLUMN "webhook_token" VARCHAR(64);
ALTER TABLE "workflows" ADD COLUMN "schedule_cron" VARCHAR(64);
ALTER TABLE "workflows" ADD COLUMN "schedule_timezone" VARCHAR(64) DEFAULT 'UTC';

CREATE UNIQUE INDEX "workflows_webhook_token_key" ON "workflows"("webhook_token");
