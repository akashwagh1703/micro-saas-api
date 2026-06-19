-- CreateTable WebsiteLead
CREATE TABLE "website_leads" (
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
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex - unique email
CREATE UNIQUE INDEX "website_leads_email_key" ON "website_leads"("email");

-- CreateIndex - email lookup
CREATE INDEX "website_leads_email_idx" ON "website_leads"("email");

-- CreateIndex - status filter
CREATE INDEX "website_leads_status_idx" ON "website_leads"("status");

-- CreateIndex - business type filter
CREATE INDEX "website_leads_business_type_idx" ON "website_leads"("business_type");

-- CreateIndex - created date filter
CREATE INDEX "website_leads_created_at_idx" ON "website_leads"("created_at");

-- CreateIndex - unique confirmation token
CREATE UNIQUE INDEX "website_leads_confirmation_token_key" ON "website_leads"("confirmation_token");
