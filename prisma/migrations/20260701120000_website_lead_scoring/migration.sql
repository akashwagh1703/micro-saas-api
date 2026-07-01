-- Add lead scoring and notes columns to website_leads (schema drift fix)
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0;
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "qualification" VARCHAR(20) DEFAULT 'cold';
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "notes" TEXT;
