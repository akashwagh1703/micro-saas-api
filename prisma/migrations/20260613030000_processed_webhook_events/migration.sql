-- Webhook idempotency dedupe table (Phase 5)

CREATE TABLE "processed_webhook_events" (
    "id" SERIAL NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processed_webhook_events_idempotency_key_key" ON "processed_webhook_events"("idempotency_key");
CREATE INDEX "processed_webhook_events_source_created_at_idx" ON "processed_webhook_events"("source", "created_at");
CREATE INDEX "processed_webhook_events_expires_at_idx" ON "processed_webhook_events"("expires_at");
