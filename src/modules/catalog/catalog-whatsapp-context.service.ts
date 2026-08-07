import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogShareService } from './catalog-share.service';
import { buildCatalogPublicUrl } from './catalog.constants';

export type CatalogWhatsAppContext = Record<string, string>;

const MAX_WA_IMAGES = 5;
const MAX_WA_PRODUCTS = 3;
const MAX_ABOUT_CHARS = 500;

/**
 * Phase 7 — live {{catalog_*}} placeholders for WhatsApp from CatalogSite.
 * Prefer published public media URLs; fall back to signed URLs for draft previews.
 * Never advertise /c/{slug} until the site is published (public page 404s otherwise).
 */
@Injectable()
export class CatalogWhatsAppContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly share: CatalogShareService,
  ) {}

  async buildContext(userId: number): Promise<CatalogWhatsAppContext> {
    const empty = this.emptyContext();

    const site = await this.prisma.catalogSite.findUnique({
      where: { userId },
      include: {
        sections: true,
        media: {
          where: { kind: 'image' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 20,
        },
        products: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: MAX_WA_PRODUCTS,
        },
      },
    });

    if (!site) {
      return empty;
    }

    const published = site.status === 'published';
    const sections = site.sections || [];
    const aboutSection = sections.find((s) => s.type === 'about' && s.enabled !== false);
    const heroSection = sections.find((s) => s.type === 'hero' && s.enabled !== false);
    const headerSection = sections.find((s) => s.type === 'header' && s.enabled !== false);
    const gallerySection = sections.find((s) => s.type === 'gallery' && s.enabled !== false);
    const productsSection = sections.find((s) => s.type === 'products' && s.enabled !== false);
    const contactSection = sections.find((s) => s.type === 'contact' && s.enabled !== false);

    const aboutConfig = asObj(aboutSection?.config);
    const heroConfig = asObj(heroSection?.config);
    const headerConfig = asObj(headerSection?.config);
    const contactConfig = asObj(contactSection?.config);
    const theme = asObj(site.theme);

    const aboutBody = String(aboutConfig.body ?? '')
      .trim()
      .slice(0, MAX_ABOUT_CHARS);
    const heroHeadline = String(heroConfig.headline ?? '').trim();
    const heroSub = String(heroConfig.subheadline ?? '').trim();
    const tagline = site.tagline?.trim() || '';
    const businessName = site.businessName?.trim() || 'our business';

    const publicBase =
      this.config.get<string>('CATALOG_PUBLIC_BASE_URL') ||
      this.config.get<string>('WEBSITE_URL') ||
      'https://autowave.playltp.in';
    const catalogUrl = buildCatalogPublicUrl(publicBase, site.slug);

    const galleryImages = gallerySection
      ? site.media.filter((m) => m.sectionId === gallerySection.id)
      : [];
    const images = (galleryImages.length > 0 ? galleryImages : site.media).slice(
      0,
      MAX_WA_IMAGES,
    );

    const imageUrls = await Promise.all(
      Array.from({ length: MAX_WA_IMAGES }, async (_, i) => {
        const media = images[i];
        if (!media) return '';
        // Published sites: stable public HTTPS proxy (good for WhatsApp fetch/cache).
        // Draft: signed URL so Meta can still download during testing.
        if (published) {
          return this.share.buildPublicMediaUrl(media.id);
        }
        try {
          return this.share.buildSignedUrl(media.id, userId, 72);
        } catch {
          return this.share.buildPublicMediaUrl(media.id);
        }
      }),
    );

    const products = productsSection ? site.products : [];
    const productsBlock = this.formatProductsBlock(products);
    const contactBlock = this.formatContactBlock(site, contactConfig);

    const welcomeExtra = [heroHeadline, heroSub, aboutBody].filter(Boolean).join('\n\n');

    const waLogoMediaId = Number(
      theme.whatsapp_logo_media_id ?? headerConfig.logo_media_id ?? 0,
    );
    const waLogoMedia =
      waLogoMediaId > 0 ? site.media.find((m) => m.id === waLogoMediaId) : undefined;
    let catalogWaLogoUrl = '';
    if (waLogoMedia) {
      if (published) {
        catalogWaLogoUrl = this.share.buildPublicMediaUrl(waLogoMedia.id);
      } else {
        try {
          catalogWaLogoUrl = this.share.buildSignedUrl(waLogoMedia.id, userId, 72);
        } catch {
          catalogWaLogoUrl = this.share.buildPublicMediaUrl(waLogoMedia.id);
        }
      }
    }

    return {
      catalog_business_name: businessName,
      catalog_tagline: tagline,
      catalog_tagline_line: tagline ? `\n_${tagline}_` : '',
      catalog_hero_headline: heroHeadline,
      catalog_hero_subheadline: heroSub,
      catalog_about: aboutBody,
      catalog_about_block: aboutBody ? `${aboutBody}\n\n` : '',
      catalog_welcome_extra: welcomeExtra ? `${welcomeExtra}\n\n` : '',
      catalog_url: published ? catalogUrl : '',
      catalog_link_block: published
        ? `Browse our full catalog anytime:\n${catalogUrl}\n\n`
        : 'Our online catalog link will be ready once the website is published. Meanwhile, reply here with any questions!\n\n',
      catalog_products_block: productsBlock,
      catalog_contact_block: contactBlock,
      catalog_image_url: imageUrls[0] || '',
      catalog_image_url_2: imageUrls[1] || '',
      catalog_image_url_3: imageUrls[2] || '',
      catalog_image_url_4: imageUrls[3] || '',
      catalog_image_url_5: imageUrls[4] || '',
      catalog_website_block: published
        ? `🌐 Explore *${businessName}* online:\n\n${catalogUrl}\n\nPhotos, products, and more — all in one place.`
        : `🌐 The website for *${businessName}* will be ready once it's published.\n\nMeanwhile, tap *Order* and we'll reach out to help!`,
      catalog_wa_logo_url: catalogWaLogoUrl,
      catalog_status: site.status || '',
      catalog_is_published: published ? '1' : '0',
      catalog_image_count: String(images.length),
    };
  }

  private emptyContext(): CatalogWhatsAppContext {
    return {
      catalog_business_name: '',
      catalog_tagline: '',
      catalog_tagline_line: '',
      catalog_hero_headline: '',
      catalog_hero_subheadline: '',
      catalog_about: '',
      catalog_about_block: '',
      catalog_welcome_extra: '',
      catalog_url: '',
      catalog_link_block:
        'Create and publish your Website page to share a full catalog link with customers.\n\n',
      catalog_website_block:
        'Create and publish your Website page to share a link with customers.',
      catalog_products_block: '',
      catalog_contact_block: '',
      catalog_image_url: '',
      catalog_image_url_2: '',
      catalog_image_url_3: '',
      catalog_image_url_4: '',
      catalog_image_url_5: '',
      catalog_wa_logo_url: '',
      catalog_status: '',
      catalog_is_published: '0',
      catalog_image_count: '0',
    };
  }

  private formatProductsBlock(
    products: Array<{
      name: string;
      priceAmount: unknown;
      priceCurrency: string;
      description: string | null;
    }>,
  ): string {
    if (!products.length) return '';
    const lines = products.map((p, i) => {
      const price =
        p.priceAmount != null && p.priceAmount !== ''
          ? formatInr(Number(p.priceAmount), p.priceCurrency)
          : null;
      const pricePart = price ? ` — ${price}` : '';
      return `${i + 1}. *${p.name}*${pricePart}`;
    });
    return `*Popular items*\n${lines.join('\n')}\n\n`;
  }

  private formatContactBlock(
    site: {
      contactPhone: string | null;
      contactWhatsapp: string | null;
      contactEmail: string | null;
      address: string | null;
    },
    contactConfig: Record<string, unknown>,
  ): string {
    const lines: string[] = [];
    if (contactConfig.show_whatsapp !== false && site.contactWhatsapp) {
      lines.push(`WhatsApp: ${site.contactWhatsapp}`);
    }
    if (contactConfig.show_phone !== false && site.contactPhone) {
      lines.push(`Phone: ${site.contactPhone}`);
    }
    if (contactConfig.show_email !== false && site.contactEmail) {
      lines.push(`Email: ${site.contactEmail}`);
    }
    if (contactConfig.show_address !== false && site.address) {
      lines.push(`Address: ${site.address}`);
    }
    const note = String(contactConfig.note ?? '').trim();
    if (note) lines.push(note);
    if (!lines.length) return '';
    return `*Contact*\n${lines.join('\n')}\n\n`;
  }
}

function asObj(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

function formatInr(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
}
