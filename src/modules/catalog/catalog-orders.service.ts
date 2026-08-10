import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogShareService } from './catalog-share.service';
import { CatalogStorageService } from './catalog-storage.service';
import { CatalogOrderNotificationService } from './catalog-order-notification.service';
import {
  CATALOG_ORDER_QUANTITY_V1,
  CATALOG_ORDER_STATUSES,
  CATALOG_PAYMENT_STATUSES,
} from './catalog-order.constants';
import { CATALOG_IMAGE_MIME, CATALOG_MAX_IMAGE_BYTES } from './catalog.constants';
import {
  AttachCatalogOrderScreenshotDto,
  CreateCatalogOrderDto,
  RejectCatalogOrderDto,
} from './dto/catalog.dto';
import { serializeCatalogOrder } from './catalog.serializer';

@Injectable()
export class CatalogOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly share: CatalogShareService,
    private readonly storage: CatalogStorageService,
    private readonly notify: CatalogOrderNotificationService,
  ) {}

  private readonly mediaUrl = (mediaId: number) => this.share.buildPublicMediaUrl(mediaId);

  /** HTTPS URL for merchant payment QR (WhatsApp image send). */
  async resolvePaymentQrUrl(userId: number): Promise<{
    url: string | null;
    upi_vpa: string | null;
    upi_payee_name: string | null;
    configured: boolean;
  }> {
    const site = await this.prisma.catalogSite.findUnique({ where: { userId } });
    if (!site?.paymentsEnabled || !site.paymentQrMediaId) {
      return {
        url: null,
        upi_vpa: site?.paymentUpiVpa ?? null,
        upi_payee_name: site?.paymentUpiPayeeName ?? null,
        configured: false,
      };
    }
    const published = site.status === 'published';
    let url: string;
    if (published) {
      url = this.share.buildPublicMediaUrl(site.paymentQrMediaId);
    } else {
      try {
        url = this.share.buildSignedUrl(site.paymentQrMediaId, userId, 72);
      } catch {
        url = this.share.buildPublicMediaUrl(site.paymentQrMediaId);
      }
    }
    return {
      url,
      upi_vpa: site.paymentUpiVpa ?? null,
      upi_payee_name: site.paymentUpiPayeeName ?? null,
      configured: true,
    };
  }

  /** WhatsApp inbound image → CatalogMedia → attach to order. */
  async attachScreenshotFromBuffer(
    userId: number,
    orderId: number,
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
  ) {
    const order = await this.requireOrder(userId, orderId);
    const mime = file.mimetype || 'image/jpeg';
    if (!CATALOG_IMAGE_MIME.has(mime)) {
      throw new BadRequestException('Payment screenshot must be jpeg, png, webp, or gif');
    }
    if (!file.buffer?.length || file.buffer.length > CATALOG_MAX_IMAGE_BYTES) {
      throw new BadRequestException('Payment screenshot must be 5MB or smaller');
    }

    const fileName = file.originalname || `payment-${order.orderNumber}.jpg`;
    const saved = await this.storage.saveBuffer(
      userId,
      'image',
      fileName,
      file.buffer,
      mime,
    );
    const media = await this.prisma.catalogMedia.create({
      data: {
        siteId: order.siteId,
        sectionId: null,
        kind: 'image',
        storageKey: saved.storageKey,
        url: saved.storageKey,
        fileName,
        mimeType: mime,
        sizeBytes: file.buffer.length,
        alt: `Payment screenshot ${order.orderNumber}`,
      },
    });
    const publicUrl = this.share.buildPublicMediaUrl(media.id);
    await this.prisma.catalogMedia.update({
      where: { id: media.id },
      data: { url: publicUrl },
    });

    return this.attachScreenshot(userId, orderId, { media_id: media.id });
  }

  async list(
    userId: number,
    opts?: { order_status?: string; payment_status?: string; limit?: number; offset?: number },
  ) {
    await this.requireSite(userId);

    const where: Prisma.CatalogOrderWhereInput = { userId };
    if (opts?.order_status) {
      if (!(CATALOG_ORDER_STATUSES as readonly string[]).includes(opts.order_status)) {
        throw new BadRequestException('Invalid order_status filter');
      }
      where.orderStatus = opts.order_status;
    }
    if (opts?.payment_status) {
      if (!(CATALOG_PAYMENT_STATUSES as readonly string[]).includes(opts.payment_status)) {
        throw new BadRequestException('Invalid payment_status filter');
      }
      where.paymentStatus = opts.payment_status;
    }

    const take = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    const skip = Math.max(opts?.offset ?? 0, 0);

    const [orders, total] = await Promise.all([
      this.prisma.catalogOrder.findMany({
        where,
        include: { paymentScreenshot: true },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.catalogOrder.count({ where }),
    ]);

    return {
      orders: orders.map((o) => serializeCatalogOrder(o, this.mediaUrl)),
      total,
      limit: take,
      offset: skip,
    };
  }

  async get(userId: number, orderId: number) {
    const order = await this.requireOrder(userId, orderId);
    return { order: serializeCatalogOrder(order, this.mediaUrl) };
  }

  /**
   * Create an order (owner test or WA Phase 4). Qty is always 1 (Phase 0 D1).
   * Does not deduct stock — that happens only on confirm.
   */
  async create(userId: number, dto: CreateCatalogOrderDto) {
    const site = await this.requireSite(userId);
    const product = await this.prisma.catalogProduct.findFirst({
      where: { id: dto.product_id, siteId: site.id },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.isActive) throw new BadRequestException('Product is not active');
    if ((product.stockQuantity ?? 0) < CATALOG_ORDER_QUANTITY_V1) {
      throw new BadRequestException('Product is out of stock');
    }

    const paymentsReady = site.paymentsEnabled && site.paymentQrMediaId != null;
    if (!paymentsReady) {
      throw new BadRequestException(
        'Merchant payments are not configured — upload a QR and enable payments first',
      );
    }

    if (dto.contact_id != null) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: dto.contact_id, userId },
      });
      if (!contact) throw new BadRequestException('contact_id not found');
    }

    const quantity = CATALOG_ORDER_QUANTITY_V1;
    const unitPrice = product.priceAmount != null ? Number(product.priceAmount) : 0;
    const amountInr = unitPrice * quantity;
    const orderNumber = await this.generateOrderNumber();

    const created = await this.prisma.catalogOrder.create({
      data: {
        orderNumber,
        userId,
        siteId: site.id,
        contactId: dto.contact_id ?? null,
        customerPhone: dto.customer_phone?.trim() || null,
        customerName: dto.customer_name?.trim() || null,
        productId: product.id,
        productName: product.name,
        productPrice: product.priceAmount,
        productImageMediaId: product.imageMediaId,
        quantity,
        amountInr,
        paymentStatus: 'payment_pending',
        orderStatus: 'pending_payment',
        notes: dto.notes?.trim() || null,
        conversationId: dto.conversation_id ?? null,
        workflowExecutionId: dto.workflow_execution_id ?? null,
      },
      include: { paymentScreenshot: true },
    });

    return { order: serializeCatalogOrder(created, this.mediaUrl) };
  }

  /** Attach payment screenshot → pending verification + notify. */
  async attachScreenshot(
    userId: number,
    orderId: number,
    dto: AttachCatalogOrderScreenshotDto,
  ) {
    const order = await this.requireOrder(userId, orderId);
    if (order.orderStatus !== 'pending_payment' && order.orderStatus !== 'pending_verification') {
      throw new ConflictException('Screenshot can only be attached while payment is pending');
    }

    const media = await this.prisma.catalogMedia.findFirst({
      where: { id: dto.media_id, siteId: order.siteId },
    });
    if (!media) throw new BadRequestException('media_id not found on this catalog site');
    if (media.kind !== 'image') {
      throw new BadRequestException('Payment screenshot must be an image');
    }

    const updated = await this.prisma.catalogOrder.update({
      where: { id: order.id },
      data: {
        paymentScreenshotMediaId: media.id,
        paymentStatus: 'payment_submitted',
        orderStatus: 'pending_verification',
      },
      include: { paymentScreenshot: true },
    });

    void this.notify.notifyPaymentSubmitted(userId, updated);

    return { order: serializeCatalogOrder(updated, this.mediaUrl) };
  }

  /**
   * Owner confirms payment: claim order status first, then deduct stock atomically.
   * Concurrent double-confirm and last-item races are rejected (Phase 6).
   */
  async confirm(userId: number, orderId: number) {
    const confirmed = await this.prisma.$transaction(async (tx) => {
      const order = await tx.catalogOrder.findFirst({
        where: {
          id: orderId,
          userId,
          orderStatus: 'pending_verification',
          paymentStatus: 'payment_submitted',
        },
      });
      if (!order) {
        const existing = await tx.catalogOrder.findFirst({
          where: { id: orderId, userId },
          select: { orderStatus: true, paymentStatus: true },
        });
        if (!existing) throw new NotFoundException('Order not found');
        throw new ConflictException(
          `Order cannot be confirmed from status "${existing.orderStatus}"`,
        );
      }
      if (!order.productId) {
        throw new BadRequestException('Order has no product — cannot deduct stock');
      }

      // Claim the order before stock decrement so two confirms cannot both win.
      const claimed = await tx.catalogOrder.updateMany({
        where: {
          id: order.id,
          userId,
          orderStatus: 'pending_verification',
          paymentStatus: 'payment_submitted',
        },
        data: {
          paymentStatus: 'payment_verified',
          orderStatus: 'confirmed',
          verifiedAt: new Date(),
          verifiedByUserId: userId,
          rejectionReason: null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Order was already confirmed or rejected');
      }

      const stockResult = await tx.catalogProduct.updateMany({
        where: {
          id: order.productId,
          siteId: order.siteId,
          stockQuantity: { gte: order.quantity },
        },
        data: { stockQuantity: { decrement: order.quantity } },
      });
      if (stockResult.count === 0) {
        // Roll back claim — another order took the last unit, or stock changed.
        await tx.catalogOrder.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'payment_submitted',
            orderStatus: 'pending_verification',
            verifiedAt: null,
            verifiedByUserId: null,
          },
        });
        throw new ConflictException(
          'Insufficient stock to confirm this order — restock or reject the order',
        );
      }

      return tx.catalogOrder.findFirstOrThrow({
        where: { id: order.id, userId },
        include: { paymentScreenshot: true },
      });
    });

    void this.notify.notifyConfirmed(userId, confirmed);

    return { order: serializeCatalogOrder(confirmed, this.mediaUrl) };
  }

  /** Owner rejects payment — no stock change. Status claim prevents double-reject races. */
  async reject(userId: number, orderId: number, dto?: RejectCatalogOrderDto) {
    const rejected = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.catalogOrder.updateMany({
        where: {
          id: orderId,
          userId,
          orderStatus: 'pending_verification',
        },
        data: {
          paymentStatus: 'payment_rejected',
          orderStatus: 'rejected',
          verifiedAt: new Date(),
          verifiedByUserId: userId,
          rejectionReason: dto?.reason?.trim() || null,
        },
      });
      if (claimed.count === 0) {
        const existing = await tx.catalogOrder.findFirst({
          where: { id: orderId, userId },
          select: { orderStatus: true },
        });
        if (!existing) throw new NotFoundException('Order not found');
        throw new ConflictException(
          `Order cannot be rejected from status "${existing.orderStatus}"`,
        );
      }
      return tx.catalogOrder.findFirstOrThrow({
        where: { id: orderId, userId },
        include: { paymentScreenshot: true },
      });
    });

    void this.notify.notifyRejected(userId, rejected);

    return { order: serializeCatalogOrder(rejected, this.mediaUrl) };
  }

  private async requireSite(userId: number) {
    const site = await this.prisma.catalogSite.findUnique({ where: { userId } });
    if (!site) throw new NotFoundException('Catalog site not found — create one first');
    return site;
  }

  private async requireOrder(userId: number, orderId: number) {
    const order = await this.prisma.catalogOrder.findFirst({
      where: { id: orderId, userId },
      include: { paymentScreenshot: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async generateOrderNumber(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const orderNumber = `CO${y}${m}${d}${rand}`;
      const exists = await this.prisma.catalogOrder.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!exists) return orderNumber;
    }
    throw new ConflictException('Could not generate a unique order number — retry');
  }
}
