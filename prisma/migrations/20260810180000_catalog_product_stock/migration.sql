-- Catalog commerce Phase 1: product stock quantity
ALTER TABLE "catalog_products" ADD COLUMN IF NOT EXISTS "stock_quantity" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "catalog_products_site_id_is_active_stock_quantity_idx"
  ON "catalog_products" ("site_id", "is_active", "stock_quantity");
