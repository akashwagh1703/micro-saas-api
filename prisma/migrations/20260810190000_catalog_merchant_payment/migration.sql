-- Catalog commerce Phase 2: per-business merchant payment QR / UPI
-- payment_qr_media_id references catalog_media.id (app-enforced; no FK to avoid create-order cycles)
ALTER TABLE "catalog_sites" ADD COLUMN IF NOT EXISTS "payment_qr_media_id" INTEGER;
ALTER TABLE "catalog_sites" ADD COLUMN IF NOT EXISTS "payment_upi_vpa" VARCHAR(80);
ALTER TABLE "catalog_sites" ADD COLUMN IF NOT EXISTS "payment_upi_payee_name" VARCHAR(120);
ALTER TABLE "catalog_sites" ADD COLUMN IF NOT EXISTS "payments_enabled" BOOLEAN NOT NULL DEFAULT false;
