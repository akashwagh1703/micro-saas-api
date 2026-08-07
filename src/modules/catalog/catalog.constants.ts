/**
 * Phase 0 — locked product decisions for Catalog / Brochure.
 * Public page has no AutoWave branding. Additive to booking/lead/CareerAI.
 */

export const CATALOG_BUSINESS_TYPE = 'catalog';
export const CATALOG_USE_CASE = 'catalog_share';

/** Public path on the marketing site: {WEBSITE_URL}/c/{slug} */
export const CATALOG_PUBLIC_PATH_PREFIX = '/c';

export const CATALOG_STATUSES = ['draft', 'published'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_SECTION_TYPES = [
  'header',
  'hero',
  'highlights',
  'about',
  'gallery',
  'products',
  'testimonials',
  'faq',
  'contact',
  'footer',
] as const;
export type CatalogSectionType = (typeof CATALOG_SECTION_TYPES)[number];

export const CATALOG_DEFAULT_SECTIONS: Array<{
  type: CatalogSectionType;
  title: string;
  sortOrder: number;
  enabled: boolean;
}> = [
  { type: 'header', title: 'Header', sortOrder: 0, enabled: true },
  { type: 'hero', title: 'Hero', sortOrder: 1, enabled: true },
  { type: 'highlights', title: 'Highlights', sortOrder: 2, enabled: true },
  { type: 'about', title: 'About', sortOrder: 3, enabled: true },
  { type: 'gallery', title: 'Gallery', sortOrder: 4, enabled: true },
  { type: 'products', title: 'Products', sortOrder: 5, enabled: true },
  { type: 'testimonials', title: 'Testimonials', sortOrder: 6, enabled: true },
  { type: 'faq', title: 'FAQ', sortOrder: 7, enabled: true },
  { type: 'contact', title: 'Contact', sortOrder: 8, enabled: true },
  { type: 'footer', title: 'Footer', sortOrder: 9, enabled: true },
];

/** Phase 2–3 caps for brochure sections. */
export const CATALOG_HIGHLIGHTS_MAX = 4;
export const CATALOG_TESTIMONIALS_MAX = 6;
export const CATALOG_FAQ_MAX = 10;
export const CATALOG_SOCIALS_MAX = 6;

export const CATALOG_SOCIAL_NETWORKS = [
  'instagram',
  'facebook',
  'youtube',
  'x',
  'linkedin',
  'website',
] as const;

/** site.theme JSON — used by public brochure (light / dark / auto). */
export const CATALOG_THEME_MODES = ['light', 'dark', 'auto'] as const;
export type CatalogThemeMode = (typeof CATALOG_THEME_MODES)[number];

export const CATALOG_DEFAULT_THEME = {
  mode: 'light' as CatalogThemeMode,
  accent: '#0c8a76',
  accent_ink: '#055445',
  hero_from: '#083642',
  hero_to: '#0f7a68',
};

/** Max slides in hero background slider. */
export const CATALOG_HERO_SLIDER_MAX = 5;

export const CATALOG_MEDIA_KINDS = ['image', 'document'] as const;
export type CatalogMediaKind = (typeof CATALOG_MEDIA_KINDS)[number];

/** MinIO object key prefix inside existing MINIO_BUCKET (folders, not new buckets). */
export const CATALOG_STORAGE_PREFIX = 'catalog';

export const CATALOG_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATALOG_SLUG_MIN = 3;
export const CATALOG_SLUG_MAX = 64;

/** Phase 2 limits — images for gallery/WhatsApp; PDFs for website docs only. */
export const CATALOG_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CATALOG_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const CATALOG_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const CATALOG_DOCUMENT_MIME = new Set([
  'application/pdf',
]);

export function buildCatalogPublicUrl(baseUrl: string, slug: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${CATALOG_PUBLIC_PATH_PREFIX}/${slug}`;
}

export function normalizeCatalogSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATALOG_SLUG_MAX);
}
