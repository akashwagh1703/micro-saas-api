-- Catalog / brochure mini-sites (Phase 1)

CREATE TABLE "catalog_sites" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "business_name" VARCHAR(160) NOT NULL,
    "tagline" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "theme" JSONB,
    "contact_phone" VARCHAR(30),
    "contact_email" VARCHAR(160),
    "contact_whatsapp" VARCHAR(30),
    "address" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_sites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_sites_user_id_key" ON "catalog_sites"("user_id");
CREATE UNIQUE INDEX "catalog_sites_slug_key" ON "catalog_sites"("slug");
CREATE INDEX "catalog_sites_status_idx" ON "catalog_sites"("status");

CREATE TABLE "catalog_sections" (
    "id" SERIAL NOT NULL,
    "site_id" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "title" VARCHAR(160),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_sections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_sections_site_id_type_key" ON "catalog_sections"("site_id", "type");
CREATE INDEX "catalog_sections_site_id_sort_order_idx" ON "catalog_sections"("site_id", "sort_order");

CREATE TABLE "catalog_media" (
    "id" SERIAL NOT NULL,
    "site_id" INTEGER NOT NULL,
    "section_id" INTEGER,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'image',
    "storage_key" VARCHAR(512) NOT NULL,
    "url" TEXT NOT NULL,
    "file_name" VARCHAR(255),
    "mime_type" VARCHAR(120),
    "size_bytes" INTEGER,
    "alt" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "catalog_media_site_id_kind_idx" ON "catalog_media"("site_id", "kind");
CREATE INDEX "catalog_media_section_id_sort_order_idx" ON "catalog_media"("section_id", "sort_order");

CREATE TABLE "catalog_products" (
    "id" SERIAL NOT NULL,
    "site_id" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "price_amount" DECIMAL(12,2),
    "price_currency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "image_media_id" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "catalog_products_site_id_sort_order_idx" ON "catalog_products"("site_id", "sort_order");

ALTER TABLE "catalog_sites" ADD CONSTRAINT "catalog_sites_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_sections" ADD CONSTRAINT "catalog_sections_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "catalog_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_media" ADD CONSTRAINT "catalog_media_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "catalog_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_media" ADD CONSTRAINT "catalog_media_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "catalog_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "catalog_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_image_media_id_fkey"
  FOREIGN KEY ("image_media_id") REFERENCES "catalog_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
