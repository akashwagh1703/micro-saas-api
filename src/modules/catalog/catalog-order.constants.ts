/** Payment verification lifecycle (catalog commerce). */
export const CATALOG_PAYMENT_STATUSES = [
  'payment_pending',
  'payment_submitted',
  'payment_verified',
  'payment_rejected',
] as const;

export type CatalogPaymentStatus = (typeof CATALOG_PAYMENT_STATUSES)[number];

/** Order fulfillment lifecycle (catalog commerce + shipping Phase A). */
export const CATALOG_ORDER_STATUSES = [
  'pending_payment',
  'pending_verification',
  'confirmed', // payment verified; awaiting shipping address
  'ready_to_ship', // address collected
  'shipped',
  'delivered',
  'rejected',
  'cancelled',
  'completed',
] as const;

export type CatalogOrderStatus = (typeof CATALOG_ORDER_STATUSES)[number];

/** Phase 0 D1 — single unit per order in v1. */
export const CATALOG_ORDER_QUANTITY_V1 = 1;

/** Phase 0 D4 — products per WhatsApp catalog page. */
export const CATALOG_WA_PRODUCTS_PER_PAGE = 5;

/** Categories per WhatsApp list page (leave room for More + Main Menu; WA max 10). */
export const CATALOG_WA_CATEGORIES_PER_PAGE = 8;
