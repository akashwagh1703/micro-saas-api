-- Optional public tracking URL for shipped WhatsApp message (Phase B)
ALTER TABLE "catalog_orders" ADD COLUMN "tracking_url" VARCHAR(500);
