-- Owner in-app notifications + mobile push device tokens
CREATE TABLE "owner_notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_device_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expo_push_token" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_device_tokens_expo_push_token_key" ON "push_device_tokens"("expo_push_token");
CREATE INDEX "owner_notifications_user_id_read_at_created_at_idx" ON "owner_notifications"("user_id", "read_at", "created_at");
CREATE INDEX "owner_notifications_user_id_created_at_idx" ON "owner_notifications"("user_id", "created_at");
CREATE INDEX "push_device_tokens_user_id_idx" ON "push_device_tokens"("user_id");

ALTER TABLE "owner_notifications" ADD CONSTRAINT "owner_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_device_tokens" ADD CONSTRAINT "push_device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
