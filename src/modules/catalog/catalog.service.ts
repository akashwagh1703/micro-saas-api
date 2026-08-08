import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CatalogShareService } from './catalog-share.service';
import { CatalogStorageService } from './catalog-storage.service';
import {
  CATALOG_BUSINESS_TYPE,
  CATALOG_DEFAULT_SECTIONS,
  CATALOG_DEFAULT_THEME,
  CATALOG_DOCUMENT_MIME,
  CATALOG_HERO_SLIDER_MAX,
  CATALOG_FAQ_MAX,
  CATALOG_HIGHLIGHTS_MAX,
  CATALOG_SOCIAL_NETWORKS,
  CATALOG_SOCIALS_MAX,
  CATALOG_TESTIMONIALS_MAX,
  CATALOG_IMAGE_MIME,
  CATALOG_MAX_DOCUMENT_BYTES,
  CATALOG_MAX_IMAGE_BYTES,
  CATALOG_MEDIA_KINDS,
  CATALOG_PUBLIC_PATH_PREFIX,
  CATALOG_SECTION_TYPES,
  CATALOG_SLUG_MAX,
  CATALOG_SLUG_MIN,
  CATALOG_SLUG_REGEX,
  CATALOG_STORAGE_PREFIX,
  CATALOG_THEME_MODES,
  CATALOG_USE_CASE,
  buildCatalogPublicUrl,
  normalizeCatalogSlug,
} from './catalog.constants';
import {
  CreateCatalogProductDto,
  CreateCatalogSiteDto,
  ReorderCatalogSectionsDto,
  UpdateCatalogMediaDto,
  UpdateCatalogProductDto,
  UpdateCatalogSectionDto,
  UpdateCatalogSiteDto,
} from './dto/catalog.dto';
import {
  serializeCatalogMedia,
  serializeCatalogProduct,
  serializeCatalogSection,
  serializeCatalogSite,
  serializePublicCatalog,
} from './catalog.serializer';

export interface CatalogMediaFilePayload {
  buffer: Buffer;
  mimeType: string;
  fileName: string | null;
  kind: string;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: CatalogStorageService,
    private readonly share: CatalogShareService,
    private readonly billing: BillingService,
  ) {}

  getPhase0Config() {
    return {
      business_type: CATALOG_BUSINESS_TYPE,
      use_case: CATALOG_USE_CASE,
      public_path_prefix: CATALOG_PUBLIC_PATH_PREFIX,
      public_url_example: buildCatalogPublicUrl(this.publicBaseUrl(), 'your-business'),
      media_public_url_example: this.share.buildPublicMediaUrl(1),
      media_signed_url_example: `${this.share.appBaseUrl()}/api/public/catalog/file?token=…`,
      section_types: [...CATALOG_SECTION_TYPES],
      default_sections: CATALOG_DEFAULT_SECTIONS,
      media_kinds: [...CATALOG_MEDIA_KINDS],
      storage_prefix: CATALOG_STORAGE_PREFIX,
      max_image_bytes: CATALOG_MAX_IMAGE_BYTES,
      max_document_bytes: CATALOG_MAX_DOCUMENT_BYTES,
      hero_slider_max: CATALOG_HERO_SLIDER_MAX,
      highlights_max: CATALOG_HIGHLIGHTS_MAX,
      testimonials_max: CATALOG_TESTIMONIALS_MAX,
      faq_max: CATALOG_FAQ_MAX,
      socials_max: CATALOG_SOCIALS_MAX,
      social_networks: [...CATALOG_SOCIAL_NETWORKS],
      theme_modes: [...CATALOG_THEME_MODES],
      default_theme: CATALOG_DEFAULT_THEME,
      products_in_v1: true,
      documents_in_v1: true,
      no_autowave_branding_on_public: true,
      slug: {
        min: CATALOG_SLUG_MIN,
        max: CATALOG_SLUG_MAX,
        pattern: CATALOG_SLUG_REGEX.source,
      },
    };
  }

  async getStorageStatus() {
    const status = await this.storage.getStorageStatus();
    return {
      ...status,
      tenant_prefix_example: this.storage.tenantPrefix(0).replace('/0', '/{userId}'),
    };
  }

  async getMine(userId: number) {
    let site = await this.findSiteForUser(userId, true);
    if (!site) {
      return { site: null };
    }
    site = await this.ensureDefaultSections(site);
    return {
      site: serializeCatalogSite(
        site,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async createSite(userId: number, dto: CreateCatalogSiteDto) {
    const existing = await this.prisma.catalogSite.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('Catalog site already exists for this account');
    }

    const slug = this.assertSlug(dto.slug);
    await this.assertSlugAvailable(slug);

    const site = await this.prisma.catalogSite.create({
      data: {
        userId,
        slug,
        businessName: dto.business_name.trim(),
        tagline: dto.tagline?.trim() || null,
        contactPhone: dto.contact_phone?.trim() || null,
        contactEmail: dto.contact_email?.trim() || null,
        contactWhatsapp: dto.contact_whatsapp?.trim() || null,
        address: dto.address?.trim() || null,
        theme: (dto.theme as Prisma.InputJsonValue) ?? CATALOG_DEFAULT_THEME,
        sections: {
          create: CATALOG_DEFAULT_SECTIONS.map((s) => ({
            type: s.type,
            title: s.title,
            sortOrder: s.sortOrder,
            enabled: s.enabled,
            config: {},
          })),
        },
      },
      include: this.siteInclude(),
    });

    return {
      site: serializeCatalogSite(
        site,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async updateSite(userId: number, dto: UpdateCatalogSiteDto) {
    const site = await this.requireSite(userId);
    const updated = await this.prisma.catalogSite.update({
      where: { id: site.id },
      data: {
        ...(dto.business_name !== undefined
          ? { businessName: dto.business_name.trim() }
          : {}),
        ...(dto.tagline !== undefined
          ? { tagline: dto.tagline?.trim() || null }
          : {}),
        ...(dto.contact_phone !== undefined
          ? { contactPhone: dto.contact_phone?.trim() || null }
          : {}),
        ...(dto.contact_email !== undefined
          ? { contactEmail: dto.contact_email?.trim() || null }
          : {}),
        ...(dto.contact_whatsapp !== undefined
          ? { contactWhatsapp: dto.contact_whatsapp?.trim() || null }
          : {}),
        ...(dto.address !== undefined
          ? { address: dto.address?.trim() || null }
          : {}),
        ...(dto.theme !== undefined
          ? {
              theme:
                dto.theme === null
                  ? Prisma.DbNull
                  : (dto.theme as Prisma.InputJsonValue),
            }
          : {}),
      },
      include: this.siteInclude(),
    });
    return {
      site: serializeCatalogSite(
        updated,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async updateSlug(userId: number, slugRaw: string) {
    const site = await this.requireSite(userId);
    const slug = this.assertSlug(slugRaw);
    if (slug !== site.slug) {
      await this.assertSlugAvailable(slug);
    }
    const updated = await this.prisma.catalogSite.update({
      where: { id: site.id },
      data: { slug },
      include: this.siteInclude(),
    });
    return {
      site: serializeCatalogSite(
        updated,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async publish(userId: number) {
    // Website add-on: draft editing stays open; only publish is gated.
    await this.billing.assertWebsiteAccess(userId);

    let site = await this.findSiteForUser(userId, true);
    if (!site) throw new NotFoundException('Catalog site not found — create one first');
    site = await this.ensureDefaultSections(site);
    const updated = await this.prisma.catalogSite.update({
      where: { id: site.id },
      data: {
        status: 'published',
        publishedAt: site.publishedAt ?? new Date(),
      },
      include: this.siteInclude(),
    });
    return {
      site: serializeCatalogSite(
        updated,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async unpublish(userId: number) {
    const site = await this.requireSite(userId);
    const updated = await this.prisma.catalogSite.update({
      where: { id: site.id },
      data: { status: 'draft' },
      include: this.siteInclude(),
    });
    return {
      site: serializeCatalogSite(
        updated,
        this.publicBaseUrl(),
        this.mediaUrl,
        { includeDraft: true },
      ),
    };
  }

  async updateSection(userId: number, sectionId: number, dto: UpdateCatalogSectionDto) {
    const site = await this.requireSite(userId);
    const section = await this.prisma.catalogSection.findFirst({
      where: { id: sectionId, siteId: site.id },
    });
    if (!section) throw new NotFoundException('Section not found');

    const updated = await this.prisma.catalogSection.update({
      where: { id: section.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title?.trim() || null } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.config !== undefined
          ? {
              config:
                dto.config === null
                  ? Prisma.DbNull
                  : (dto.config as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
    return { section: serializeCatalogSection(updated) };
  }

  async reorderSections(userId: number, dto: ReorderCatalogSectionsDto) {
    const site = await this.requireSite(userId);
    const ids = dto.sections.map((s) => s.id);
    const existing = await this.prisma.catalogSection.findMany({
      where: { siteId: site.id, id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('One or more sections do not belong to this site');
    }

    await this.prisma.$transaction(
      dto.sections.map((s) =>
        this.prisma.catalogSection.update({
          where: { id: s.id },
          data: { sortOrder: s.sort_order },
        }),
      ),
    );

    const sections = await this.prisma.catalogSection.findMany({
      where: { siteId: site.id },
      orderBy: { sortOrder: 'asc' },
    });
    return { sections: sections.map(serializeCatalogSection) };
  }

  async listProducts(userId: number) {
    const site = await this.requireSite(userId);
    const products = await this.prisma.catalogProduct.findMany({
      where: { siteId: site.id },
      include: { image: true },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      products: products.map((p) => serializeCatalogProduct(p, this.mediaUrl)),
    };
  }

  async createProduct(userId: number, dto: CreateCatalogProductDto) {
    const site = await this.requireSite(userId);
    if (dto.image_media_id != null) {
      await this.assertMediaOnSite(site.id, dto.image_media_id);
    }
    const product = await this.prisma.catalogProduct.create({
      data: {
        siteId: site.id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        priceAmount:
          dto.price_amount != null ? new Prisma.Decimal(dto.price_amount) : null,
        priceCurrency: (dto.price_currency || 'INR').toUpperCase(),
        imageMediaId: dto.image_media_id ?? null,
        sortOrder: dto.sort_order ?? 0,
        isActive: dto.is_active ?? true,
      },
      include: { image: true },
    });
    return { product: serializeCatalogProduct(product, this.mediaUrl) };
  }

  async updateProduct(userId: number, productId: number, dto: UpdateCatalogProductDto) {
    const site = await this.requireSite(userId);
    const product = await this.prisma.catalogProduct.findFirst({
      where: { id: productId, siteId: site.id },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (dto.image_media_id != null) {
      await this.assertMediaOnSite(site.id, dto.image_media_id);
    }

    const updated = await this.prisma.catalogProduct.update({
      where: { id: product.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.price_amount !== undefined
          ? {
              priceAmount:
                dto.price_amount == null
                  ? null
                  : new Prisma.Decimal(dto.price_amount),
            }
          : {}),
        ...(dto.price_currency !== undefined
          ? { priceCurrency: dto.price_currency.toUpperCase() }
          : {}),
        ...(dto.image_media_id !== undefined
          ? { imageMediaId: dto.image_media_id }
          : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
      include: { image: true },
    });
    return { product: serializeCatalogProduct(updated, this.mediaUrl) };
  }

  async deleteProduct(userId: number, productId: number) {
    const site = await this.requireSite(userId);
    const product = await this.prisma.catalogProduct.findFirst({
      where: { id: productId, siteId: site.id },
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.catalogProduct.delete({ where: { id: product.id } });
    return { ok: true };
  }

  async listMedia(userId: number) {
    const site = await this.requireSite(userId);
    const media = await this.prisma.catalogMedia.findMany({
      where: { siteId: site.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return {
      media: media.map((m) => serializeCatalogMedia(m, this.mediaUrl)),
    };
  }

  async uploadMedia(
    userId: number,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
    opts: { kind?: string; section_id?: number; alt?: string },
  ) {
    const site = await this.requireSite(userId);
    const kind = (opts.kind || 'image') as 'image' | 'document';
    if (!CATALOG_MEDIA_KINDS.includes(kind)) {
      throw new BadRequestException('kind must be image or document');
    }

    const mime = file.mimetype || 'application/octet-stream';
    if (kind === 'image') {
      if (!CATALOG_IMAGE_MIME.has(mime)) {
        throw new BadRequestException('Images must be jpeg, png, webp, or gif');
      }
      if (file.size > CATALOG_MAX_IMAGE_BYTES) {
        throw new BadRequestException('Image must be 5MB or smaller');
      }
    } else {
      if (!CATALOG_DOCUMENT_MIME.has(mime)) {
        throw new BadRequestException('Documents must be PDF');
      }
      if (file.size > CATALOG_MAX_DOCUMENT_BYTES) {
        throw new BadRequestException('Document must be 10MB or smaller');
      }
    }

    let sectionId: number | null = null;
    if (opts.section_id != null) {
      const section = await this.prisma.catalogSection.findFirst({
        where: { id: opts.section_id, siteId: site.id },
      });
      if (!section) throw new BadRequestException('section_id not found on this site');
      sectionId = section.id;
    }

    const fileName = file.originalname || `upload.${kind === 'image' ? 'jpg' : 'pdf'}`;
    const saved = await this.storage.saveBuffer(
      userId,
      kind,
      fileName,
      file.buffer,
      mime,
    );

    // Placeholder URL updated immediately after create with stable API proxy URL.
    const media = await this.prisma.catalogMedia.create({
      data: {
        siteId: site.id,
        sectionId,
        kind,
        storageKey: saved.storageKey,
        url: saved.storageKey,
        fileName,
        mimeType: mime,
        sizeBytes: file.size,
        alt: opts.alt?.trim() || null,
      },
    });

    const publicUrl = this.share.buildPublicMediaUrl(media.id);
    const updated = await this.prisma.catalogMedia.update({
      where: { id: media.id },
      data: { url: publicUrl },
    });

    return { media: serializeCatalogMedia(updated, this.mediaUrl) };
  }

  async updateMedia(userId: number, mediaId: number, dto: UpdateCatalogMediaDto) {
    const site = await this.requireSite(userId);
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId, siteId: site.id },
    });
    if (!media) throw new NotFoundException('Media not found');

    if (dto.section_id != null) {
      const section = await this.prisma.catalogSection.findFirst({
        where: { id: dto.section_id, siteId: site.id },
      });
      if (!section) throw new BadRequestException('section_id not found on this site');
    }

    const updated = await this.prisma.catalogMedia.update({
      where: { id: media.id },
      data: {
        ...(dto.alt !== undefined ? { alt: dto.alt?.trim() || null } : {}),
        ...(dto.section_id !== undefined ? { sectionId: dto.section_id } : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      },
    });
    return { media: serializeCatalogMedia(updated, this.mediaUrl) };
  }

  async deleteMedia(userId: number, mediaId: number) {
    const site = await this.requireSite(userId);
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId, siteId: site.id },
    });
    if (!media) throw new NotFoundException('Media not found');

    await this.prisma.catalogProduct.updateMany({
      where: { siteId: site.id, imageMediaId: media.id },
      data: { imageMediaId: null },
    });
    await this.prisma.catalogMedia.delete({ where: { id: media.id } });
    await this.storage.deleteFile(media.storageKey);
    return { ok: true };
  }

  /** Owner draft preview — auth required. */
  async getOwnerMediaFile(
    userId: number,
    mediaId: number,
  ): Promise<CatalogMediaFilePayload> {
    const site = await this.requireSite(userId);
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId, siteId: site.id },
    });
    if (!media) throw new NotFoundException('Media not found');
    return this.readMediaFile(media);
  }

  /** Create a time-limited HTTPS URL for WhatsApp / temporary share. */
  async createSignedMediaUrl(userId: number, mediaId: number, ttlHours?: number) {
    const site = await this.requireSite(userId);
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId, siteId: site.id },
    });
    if (!media) throw new NotFoundException('Media not found');

    const hours = ttlHours && ttlHours > 0 ? Math.min(ttlHours, 168) : undefined;
    const url = this.share.buildSignedUrl(media.id, userId, hours);
    return {
      url,
      media_id: media.id,
      expires_in_hours: hours ?? parseInt(
        this.config.get<string>('CATALOG_SHARE_TTL_HOURS') ?? '72',
        10,
      ),
    };
  }

  /**
   * Public media for published catalogs only.
   * GET /api/public/catalog/media/:id
   */
  async getPublishedMediaFile(mediaId: number): Promise<CatalogMediaFilePayload> {
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId },
      include: { site: { select: { status: true } } },
    });
    if (!media || media.site.status !== 'published') {
      throw new NotFoundException('Media not found');
    }
    return this.readMediaFile(media);
  }

  /** Signed download — works for draft or published (token proves ownership window). */
  async getSignedMediaFile(token: string): Promise<CatalogMediaFilePayload> {
    const payload = this.share.verifyToken(token);
    if (!payload) throw new NotFoundException('Invalid or expired link');

    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: payload.mediaId },
      include: { site: { select: { userId: true } } },
    });
    if (!media || media.site.userId !== payload.userId) {
      throw new NotFoundException('Invalid or expired link');
    }
    return this.readMediaFile(media);
  }

  async getPublicBySlug(slugRaw: string) {
    const slug = normalizeCatalogSlug(slugRaw);
    if (!slug || !CATALOG_SLUG_REGEX.test(slug)) {
      throw new NotFoundException('Catalog not found');
    }

    const site = await this.prisma.catalogSite.findFirst({
      where: { slug, status: 'published' },
      include: this.siteInclude(),
    });
    if (!site) throw new NotFoundException('Catalog not found');

    return {
      catalog: serializePublicCatalog(site, this.publicBaseUrl(), this.mediaUrl),
    };
  }

  private readonly mediaUrl = (mediaId: number) =>
    this.share.buildPublicMediaUrl(mediaId);

  private async readMediaFile(media: {
    storageKey: string;
    mimeType: string | null;
    fileName: string | null;
    kind: string;
  }): Promise<CatalogMediaFilePayload> {
    const buffer = await this.storage.readBuffer(media.storageKey);
    if (!buffer) throw new NotFoundException('Media file missing from storage');
    return {
      buffer,
      mimeType: media.mimeType || 'application/octet-stream',
      fileName: media.fileName,
      kind: media.kind,
    };
  }

  private publicBaseUrl(): string {
    return (
      this.config.get<string>('CATALOG_PUBLIC_BASE_URL') ||
      this.config.get<string>('WEBSITE_URL') ||
      'http://localhost:5174'
    );
  }

  private siteInclude() {
    return {
      sections: { orderBy: { sortOrder: 'asc' as const } },
      media: { orderBy: { sortOrder: 'asc' as const } },
      products: {
        orderBy: { sortOrder: 'asc' as const },
        include: { image: true },
      },
    };
  }

  /** Adds any missing default sections (e.g. footer) for older sites. */
  private async ensureDefaultSections<T extends { id: number; userId: number; sections?: { type: string }[] }>(
    site: T,
  ): Promise<T> {
    const existing = new Set((site.sections ?? []).map((s) => s.type));
    const missing = CATALOG_DEFAULT_SECTIONS.filter((s) => !existing.has(s.type));
    if (!missing.length) return site;

    await this.prisma.catalogSection.createMany({
      data: missing.map((s) => ({
        siteId: site.id,
        type: s.type,
        title: s.title,
        sortOrder: s.sortOrder,
        enabled: s.enabled,
        config: {},
      })),
    });

    const refreshed = await this.findSiteForUser(site.userId, true);
    return (refreshed ?? site) as T;
  }

  private async findSiteForUser(userId: number, withRelations: boolean) {
    return this.prisma.catalogSite.findUnique({
      where: { userId },
      ...(withRelations ? { include: this.siteInclude() } : {}),
    });
  }

  private async requireSite(userId: number) {
    const site = await this.findSiteForUser(userId, false);
    if (!site) throw new NotFoundException('Catalog site not found — create one first');
    return site;
  }

  private assertSlug(raw: string): string {
    const slug = normalizeCatalogSlug(raw);
    if (
      slug.length < CATALOG_SLUG_MIN ||
      slug.length > CATALOG_SLUG_MAX ||
      !CATALOG_SLUG_REGEX.test(slug)
    ) {
      throw new BadRequestException(
        `slug must be ${CATALOG_SLUG_MIN}–${CATALOG_SLUG_MAX} chars: lowercase letters, numbers, hyphens`,
      );
    }
    return slug;
  }

  private async assertSlugAvailable(slug: string) {
    const taken = await this.prisma.catalogSite.findUnique({ where: { slug } });
    if (taken) throw new ConflictException('This slug is already taken');
  }

  private async assertMediaOnSite(siteId: number, mediaId: number) {
    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: mediaId, siteId },
    });
    if (!media) throw new BadRequestException('image_media_id not found on this site');
  }
}
