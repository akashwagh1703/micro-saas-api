import {
  CatalogMedia,
  CatalogProduct,
  CatalogSection,
  CatalogSite,
} from '@prisma/client';
import { buildCatalogPublicUrl } from './catalog.constants';

type SiteWithRelations = CatalogSite & {
  sections?: CatalogSection[];
  media?: CatalogMedia[];
  products?: (CatalogProduct & { image?: CatalogMedia | null })[];
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

export function serializeCatalogProduct(
  p: CatalogProduct & { image?: CatalogMedia | null },
  publicMediaUrl: (mediaId: number) => string,
) {
  return {
    id: p.id,
    site_id: p.siteId,
    name: p.name,
    description: p.description,
    price_amount: p.priceAmount != null ? Number(p.priceAmount) : null,
    price_currency: p.priceCurrency,
    image_media_id: p.imageMediaId,
    image: p.image ? serializeCatalogMedia(p.image, publicMediaUrl) : null,
    sort_order: p.sortOrder,
    is_active: p.isActive,
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
    media: media.map((m) => serializeCatalogMedia(m, publicMediaUrl)),
    products: products
      .filter((p) => opts?.includeDraft || p.isActive)
      .map((p) => serializeCatalogProduct(p, publicMediaUrl)),
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
    products: full.products,
  };
}
