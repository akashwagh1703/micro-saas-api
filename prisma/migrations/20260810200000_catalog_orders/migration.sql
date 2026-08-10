-- Catalog commerce Phase 3: orders + payment verification
CREATE TABLE "catalog_orders" (
    "id" SERIAL NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "site_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "customer_phone" VARCHAR(30),
    "customer_name" VARCHAR(160),
    "product_id" INTEGER,
    "product_name" VARCHAR(160) NOT NULL,
    "product_price" DECIMAL(12,2),
    "product_image_media_id" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount_inr" DECIMAL(12,2) NOT NULL,
    "payment_status" VARCHAR(32) NOT NULL,
    "order_status" VARCHAR(32) NOT NULL,
    "payment_screenshot_media_id" INTEGER,
    "verified_at" TIMESTAMP(3),
    "verified_by_user_id" INTEGER,
    "rejection_reason" VARCHAR(500),
    "notes" TEXT,
    "conversation_id" INTEGER,
    "workflow_execution_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_orders_order_number_key" ON "catalog_orders"("order_number");
CREATE INDEX "catalog_orders_user_id_created_at_idx" ON "catalog_orders"("user_id", "created_at");
CREATE INDEX "catalog_orders_user_id_order_status_created_at_idx" ON "catalog_orders"("user_id", "order_status", "created_at");
CREATE INDEX "catalog_orders_user_id_payment_status_created_at_idx" ON "catalog_orders"("user_id", "payment_status", "created_at");
CREATE INDEX "catalog_orders_site_id_created_at_idx" ON "catalog_orders"("site_id", "created_at");

ALTER TABLE "catalog_orders" ADD CONSTRAINT "catalog_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_orders" ADD CONSTRAINT "catalog_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "catalog_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_orders" ADD CONSTRAINT "catalog_orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog_orders" ADD CONSTRAINT "catalog_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog_orders" ADD CONSTRAINT "catalog_orders_payment_screenshot_media_id_fkey" FOREIGN KEY ("payment_screenshot_media_id") REFERENCES "catalog_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
