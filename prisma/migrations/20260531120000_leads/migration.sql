-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "contact_id" INTEGER,
    "conversation_id" INTEGER,
    "workflow_id" INTEGER,
    "execution_id" INTEGER,
    "name" TEXT,
    "phone" TEXT,
    "username" TEXT,
    "source_message" TEXT,
    "collected" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_user_id_status_created_at_idx" ON "leads"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_user_id_channel_created_at_idx" ON "leads"("user_id", "channel", "created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
