-- Catalog order shipping address + tracking (Phase A)
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_name" VARCHAR(160);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_address_line" VARCHAR(500);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_city" VARCHAR(120);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_state" VARCHAR(120);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_pincode" VARCHAR(12);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_landmark" VARCHAR(255);
ALTER TABLE "catalog_orders" ADD COLUMN "shipping_phone" VARCHAR(30);
ALTER TABLE "catalog_orders" ADD COLUMN "courier_name" VARCHAR(120);
ALTER TABLE "catalog_orders" ADD COLUMN "tracking_number" VARCHAR(80);
ALTER TABLE "catalog_orders" ADD COLUMN "shipped_at" TIMESTAMP(3);
ALTER TABLE "catalog_orders" ADD COLUMN "delivered_at" TIMESTAMP(3);
