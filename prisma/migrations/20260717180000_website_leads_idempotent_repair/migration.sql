-- Idempotent repair: demo form (website_leads) when table exists but columns drifted.
-- Safe if 20260619120000 / 20260701120000 already applied.

CREATE TABLE IF NOT EXISTS "website_leads" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" VARCHAR(50) NOT NULL,
    "company_name" TEXT,
    "monthly_messages" INTEGER,
    "challenge" TEXT,
    "source" VARCHAR(50) NOT NULL DEFAULT 'website',
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "demo_date" TIMESTAMP(3),
    "demo_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_token" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0;
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "qualification" VARCHAR(20) DEFAULT 'cold';
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "website_leads" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "website_leads_email_key" ON "website_leads"("email");
CREATE INDEX IF NOT EXISTS "website_leads_email_idx" ON "website_leads"("email");
CREATE INDEX IF NOT EXISTS "website_leads_status_idx" ON "website_leads"("status");
CREATE INDEX IF NOT EXISTS "website_leads_business_type_idx" ON "website_leads"("business_type");
CREATE INDEX IF NOT EXISTS "website_leads_created_at_idx" ON "website_leads"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "website_leads_confirmation_token_key" ON "website_leads"("confirmation_token");
