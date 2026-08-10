-- Catalog product categories for WhatsApp browse
CREATE TABLE "catalog_categories" (
    "id" SERIAL NOT NULL,
    "site_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "catalog_categories_site_id_sort_order_idx" ON "catalog_categories"("site_id", "sort_order");
CREATE INDEX "catalog_categories_site_id_is_active_idx" ON "catalog_categories"("site_id", "is_active");

ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "catalog_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_products" ADD COLUMN "category_id" INTEGER;

CREATE INDEX "catalog_products_site_id_category_id_sort_order_idx" ON "catalog_products"("site_id", "category_id", "sort_order");

ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
