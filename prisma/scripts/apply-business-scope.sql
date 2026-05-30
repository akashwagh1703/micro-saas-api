-- Run once against Render Postgres (External URL). Safe to re-run (IF NOT EXISTS).
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "business_category" TEXT;
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "use_case" TEXT;
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "workflows_user_id_business_category_is_archived_idx"
  ON "workflows"("user_id", "business_category", "is_archived");
