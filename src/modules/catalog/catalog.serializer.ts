import {
  CatalogCategory,
  CatalogMedia,
  CatalogOrder,
  CatalogProduct,
  CatalogSection,
  CatalogSite,
} from '@prisma/client';
import { buildCatalogPublicUrl } from './catalog.constants';

type SiteWithRelations = CatalogSite & {
  sections?: CatalogSection[];
  media?: CatalogMedia[];
  categories?: CatalogCategory[];
  products?: (CatalogProduct & {
    image?: CatalogMedia | null;
    category?: CatalogCategory | null;
  })[];
};

export function serializeCatalogMedia(
  m: CatalogMedia,
  publicMediaUrl: (mediaId: number) => string,
) {
  return {
    id: m.id,
    site_id: m.siteId,
    section_id: m.sectionId,
    kind: m.kind,
    storage_key: m.storageKey,
    /** Stable HTTPS URL via API proxy (works even when MinIO is private). */
    url: publicMediaUrl(m.id),
    file_name: m.fileName,
    mime_type: m.mimeType,
    size_bytes: m.sizeBytes,
    alt: m.alt,
    sort_order: m.sortOrder,
    created_at: m.createdAt,
  };
}

export function serializeCatalogSection(s: CatalogSection) {
  return {
    id: s.id,
    site_id: s.siteId,
    type: s.type,
    title: s.title,
    enabled: s.enabled,
    sort_order: s.sortOrder,
    config: s.config,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function serializeCatalogCategory(c: CatalogCategory) {
  return {
    id: c.id,
    site_id: c.siteId,
    name: c.name,
    description: c.description,
    sort_order: c.sortOrder,
    is_active: c.isActive,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function serializeCatalogProduct(
  p: CatalogProduct & { image?: CatalogMedia | null; category?: CatalogCategory | null },
  publicMediaUrl: (mediaId: number) => string,
) {
  const stockQuantity = p.stockQuantity ?? 0;
  return {
    id: p.id,
    site_id: p.siteId,
    category_id: p.categoryId ?? null,
    category: p.category ? serializeCatalogCategory(p.category) : null,
    name: p.name,
    description: p.description,
    price_amount: p.priceAmount != null ? Number(p.priceAmount) : null,
    price_currency: p.priceCurrency,
    image_media_id: p.imageMediaId,
    image: p.image ? serializeCatalogMedia(p.image, publicMediaUrl) : null,
    sort_order: p.sortOrder,
    is_active: p.isActive,
    stock_quantity: stockQuantity,
    /** Derived: stock_quantity > 0 → in_stock; else out_of_stock */
    stock_status: stockQuantity > 0 ? ('in_stock' as const) : ('out_of_stock' as const),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function serializeCatalogSite(
  site: SiteWithRelations,
  publicBaseUrl: string,
  publicMediaUrl: (mediaId: number) => string,
  opts?: { includeDraft?: boolean },
) {
  const sections = [...(site.sections ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const categories = [...(site.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const products = [...(site.products ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const media = [...(site.media ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: site.id,
    user_id: site.userId,
    slug: site.slug,
    business_name: site.businessName,
    tagline: site.tagline,
    status: site.status,
    theme: site.theme,
    contact_phone: site.contactPhone,
    contact_email: site.contactEmail,
    contact_whatsapp: site.contactWhatsapp,
    address: site.address,
    published_at: site.publishedAt,
    public_url: buildCatalogPublicUrl(publicBaseUrl, site.slug),
    created_at: site.createdAt,
    updated_at: site.updatedAt,
    sections: sections.map(serializeCatalogSection),
    categories: categories
      .filter((c) => opts?.includeDraft || c.isActive)
      .map(serializeCatalogCategory),
    media: media.map((m) => serializeCatalogMedia(m, publicMediaUrl)),
    products: products
      .filter((p) => opts?.includeDraft || p.isActive)
      .map((p) => serializeCatalogProduct(p, publicMediaUrl)),
    /** Owner-only merchant checkout settings (not exposed on public brochure). */
    payment: serializeCatalogPayment(site, media, publicMediaUrl),
  };
}

export function serializeCatalogPayment(
  site: CatalogSite,
  media: CatalogMedia[] | undefined,
  publicMediaUrl: (mediaId: number) => string,
) {
  const qrMediaId = site.paymentQrMediaId ?? null;
  const qr =
    qrMediaId != null
      ? (media ?? []).find((m) => m.id === qrMediaId) ?? null
      : null;
  const paymentsEnabled = site.paymentsEnabled === true;
  return {
    payments_enabled: paymentsEnabled,
    upi_vpa: site.paymentUpiVpa ?? null,
    upi_payee_name: site.paymentUpiPayeeName ?? null,
    qr_media_id: qrMediaId,
    qr: qr ? serializeCatalogMedia(qr, publicMediaUrl) : null,
    configured: paymentsEnabled && qrMediaId != null,
  };
}

export function serializeCatalogOrder(
  order: CatalogOrder & { paymentScreenshot?: CatalogMedia | null },
  publicMediaUrl: (mediaId: number) => string,
) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    user_id: order.userId,
    site_id: order.siteId,
    contact_id: order.contactId,
    customer_phone: order.customerPhone,
    customer_name: order.customerName,
    product_id: order.productId,
    product_name: order.productName,
    product_price: order.productPrice != null ? Number(order.productPrice) : null,
    product_image_media_id: order.productImageMediaId,
    product_image_url:
      order.productImageMediaId != null
        ? publicMediaUrl(order.productImageMediaId)
        : null,
    quantity: order.quantity,
    amount_inr: Number(order.amountInr),
    payment_status: order.paymentStatus,
    order_status: order.orderStatus,
    payment_screenshot_media_id: order.paymentScreenshotMediaId,
    payment_screenshot: order.paymentScreenshot
      ? serializeCatalogMedia(order.paymentScreenshot, publicMediaUrl)
      : order.paymentScreenshotMediaId != null
        ? {
            id: order.paymentScreenshotMediaId,
            url: publicMediaUrl(order.paymentScreenshotMediaId),
          }
        : null,
    verified_at: order.verifiedAt,
    verified_by_user_id: order.verifiedByUserId,
    rejection_reason: order.rejectionReason,
    notes: order.notes,
    shipping_name: order.shippingName ?? null,
    shipping_address_line: order.shippingAddressLine ?? null,
    shipping_city: order.shippingCity ?? null,
    shipping_state: order.shippingState ?? null,
    shipping_pincode: order.shippingPincode ?? null,
    shipping_landmark: order.shippingLandmark ?? null,
    shipping_phone: order.shippingPhone ?? null,
    courier_name: order.courierName ?? null,
    tracking_number: order.trackingNumber ?? null,
    tracking_url: order.trackingUrl ?? null,
    shipped_at: order.shippedAt ?? null,
    delivered_at: order.deliveredAt ?? null,
    has_shipping_address: Boolean(order.shippingAddressLine && order.shippingPincode),
    conversation_id: order.conversationId,
    workflow_execution_id: order.workflowExecutionId,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}

/** Public payload: no AutoWave fields, only enabled sections + active products. */
export function serializePublicCatalog(
  site: SiteWithRelations,
  publicBaseUrl: string,
  publicMediaUrl: (mediaId: number) => string,
) {
  const full = serializeCatalogSite(site, publicBaseUrl, publicMediaUrl, {
    includeDraft: false,
  });
  // Intentionally omit `payment` — merchant QR is private to WA checkout / owner portal.
  return {
    slug: full.slug,
    business_name: full.business_name,
    tagline: full.tagline,
    theme: full.theme,
    contact_phone: full.contact_phone,
    contact_email: full.contact_email,
    contact_whatsapp: full.contact_whatsapp,
    address: full.address,
    public_url: full.public_url,
    published_at: full.published_at,
    sections: full.sections.filter((s) => s.enabled),
    media: full.media,
    categories: full.categories,
    products: full.products,
  };
}
