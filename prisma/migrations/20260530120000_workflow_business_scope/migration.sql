-- AlterTable
ALTER TABLE "workflows" ADD COLUMN "business_category" TEXT;
ALTER TABLE "workflows" ADD COLUMN "use_case" TEXT;
ALTER TABLE "workflows" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "workflows_user_id_business_category_is_archived_idx" ON "workflows"("user_id", "business_category", "is_archived");
