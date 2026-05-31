-- Phase 1: Instagram channel layer (schema only; connection + webhooks in later phases)

-- InstagramAccount (one per user, mirrors WhatsAppAccount)
CREATE TABLE "instagram_accounts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "instagram_user_id" TEXT,
    "page_id" TEXT,
    "access_token" TEXT,
    "verify_token" TEXT,
    "app_secret" TEXT,
    "username" TEXT,
    "display_name" TEXT,
    "is_connected" BOOLEAN NOT NULL DEFAULT false,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instagram_accounts_user_id_key" ON "instagram_accounts"("user_id");

ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contact: channel + Instagram identity; phone optional for IG-only contacts
ALTER TABLE "contacts" ADD COLUMN "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "contacts" ADD COLUMN "instagram_user_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "username" TEXT;

UPDATE "contacts" SET "channel" = 'whatsapp' WHERE "channel" IS NULL;

ALTER TABLE "contacts" ALTER COLUMN "phone" DROP NOT NULL;

CREATE UNIQUE INDEX "contacts_user_id_instagram_user_id_key"
    ON "contacts"("user_id", "instagram_user_id")
    WHERE "instagram_user_id" IS NOT NULL;

CREATE INDEX "contacts_user_id_channel_last_message_at_idx"
    ON "contacts"("user_id", "channel", "last_message_at");

-- Conversation: channel + optional Instagram account link
ALTER TABLE "conversations" ADD COLUMN "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "conversations" ADD COLUMN "instagram_account_id" INTEGER;

UPDATE "conversations" SET "channel" = 'whatsapp' WHERE "channel" IS NULL;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_instagram_account_id_fkey"
    FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "conversations_user_id_channel_last_message_at_idx"
    ON "conversations"("user_id", "channel", "last_message_at");

-- Message: channel + generic external id (Instagram Graph message id, etc.)
ALTER TABLE "messages" ADD COLUMN "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "messages" ADD COLUMN "external_message_id" TEXT;

UPDATE "messages" SET "channel" = 'whatsapp' WHERE "channel" IS NULL;

CREATE INDEX "messages_user_id_channel_created_at_idx"
    ON "messages"("user_id", "channel", "created_at");

CREATE INDEX "messages_user_id_external_message_id_idx"
    ON "messages"("user_id", "external_message_id");
