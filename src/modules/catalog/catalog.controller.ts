import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { CatalogOrdersService } from './catalog-orders.service';
import {
  AttachCatalogOrderScreenshotDto,
  CreateCatalogCategoryDto,
  CreateCatalogOrderDto,
  CreateCatalogProductDto,
  CreateCatalogSiteDto,
  BulkMarkCatalogOrdersShippedDto,
  MarkCatalogOrderShippedDto,
  RejectCatalogOrderDto,
  ReorderCatalogSectionsDto,
  SetCatalogOrderShippingAddressDto,
  UpdateCatalogCategoryDto,
  UpdateCatalogMediaDto,
  UpdateCatalogPaymentSettingsDto,
  UpdateCatalogProductDto,
  UpdateCatalogSectionDto,
  UpdateCatalogSiteDto,
  UpdateCatalogSlugDto,
} from './dto/catalog.dto';
import { CATALOG_MAX_DOCUMENT_BYTES } from './catalog.constants';

@Controller('catalog')
@UseGuards(TokenAuthGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly orders: CatalogOrdersService,
  ) {}

  /** Phase 0 locked decisions — useful for portal/app builders. */
  @Get('config')
  config() {
    return this.catalog.getPhase0Config();
  }

  /** MinIO / local storage readiness for the website builder. */
  @Get('storage/status')
  storageStatus() {
    return this.catalog.getStorageStatus();
  }

  @Get()
  getMine(@CurrentUser('id') userId: number) {
    return this.catalog.getMine(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: number, @Body() dto: CreateCatalogSiteDto) {
    return this.catalog.createSite(userId, dto);
  }

  @Patch()
  update(@CurrentUser('id') userId: number, @Body() dto: UpdateCatalogSiteDto) {
    return this.catalog.updateSite(userId, dto);
  }

  @Patch('slug')
  updateSlug(@CurrentUser('id') userId: number, @Body() dto: UpdateCatalogSlugDto) {
    return this.catalog.updateSlug(userId, dto.slug);
  }

  @Post('publish')
  publish(@CurrentUser('id') userId: number) {
    return this.catalog.publish(userId);
  }

  @Post('unpublish')
  unpublish(@CurrentUser('id') userId: number) {
    return this.catalog.unpublish(userId);
  }

  @Patch('sections/:id')
  updateSection(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCatalogSectionDto,
  ) {
    return this.catalog.updateSection(userId, id, dto);
  }

  @Put('sections/reorder')
  reorderSections(
    @CurrentUser('id') userId: number,
    @Body() dto: ReorderCatalogSectionsDto,
  ) {
    return this.catalog.reorderSections(userId, dto);
  }

  @Get('categories')
  listCategories(@CurrentUser('id') userId: number) {
    return this.catalog.listCategories(userId);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateCatalogCategoryDto,
  ) {
    return this.catalog.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCatalogCategoryDto,
  ) {
    return this.catalog.updateCategory(userId, id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.catalog.deleteCategory(userId, id);
  }

  @Get('products')
  listProducts(@CurrentUser('id') userId: number) {
    return this.catalog.listProducts(userId);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateCatalogProductDto,
  ) {
    return this.catalog.createProduct(userId, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCatalogProductDto,
  ) {
    return this.catalog.updateProduct(userId, id, dto);
  }

  @Delete('products/:id')
  deleteProduct(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.catalog.deleteProduct(userId, id);
  }

  /** Merchant UPI / QR for catalog order checkout (per business). */
  @Get('payment-settings')
  getPaymentSettings(@CurrentUser('id') userId: number) {
    return this.catalog.getPaymentSettings(userId);
  }

  @Patch('payment-settings')
  updatePaymentSettings(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateCatalogPaymentSettingsDto,
  ) {
    return this.catalog.updatePaymentSettings(userId, dto);
  }

  /** Catalog commerce orders (Phase 3 + shipping Phase A). */
  @Get('orders')
  listOrders(
    @CurrentUser('id') userId: number,
    @Query('order_status') orderStatus?: string,
    @Query('payment_status') paymentStatus?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : undefined;
    return this.orders.list(userId, {
      order_status: orderStatus,
      payment_status: paymentStatus,
      q,
      from,
      to,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
  }

  /** Sales / income analytics — must be registered before orders/:id */
  @Get('orders/analytics')
  salesAnalytics(
    @CurrentUser('id') userId: number,
    @Query('days') days?: string,
  ) {
    return this.orders.salesAnalytics(userId, days);
  }

  /** CSV export for Excel — must be registered before orders/:id */
  @Get('orders/export.csv')
  async exportOrdersCsv(
    @CurrentUser('id') userId: number,
    @Res() res: Response,
    @Query('order_status') orderStatus?: string,
    @Query('payment_status') paymentStatus?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.orders.exportCsv(userId, {
      order_status: orderStatus,
      payment_status: paymentStatus,
      q,
      from,
      to,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="catalog-orders-${stamp}.csv"`,
    );
    // BOM so Excel opens UTF-8 correctly
    res.send(`\uFEFF${csv}`);
  }

  /** Static paths must stay above orders/:id */
  @Get('orders/packing-slips.pdf')
  async packingSlipsPdf(
    @CurrentUser('id') userId: number,
    @Query('ids') idsRaw: string | undefined,
    @Res() res: Response,
  ) {
    const ids = String(idsRaw || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const pdf = await this.orders.packingSlipPdf(userId, ids);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="packing-slips-${ids.length}.pdf"`,
    );
    res.send(pdf);
  }

  @Post('orders/bulk-ship')
  bulkMarkOrdersShipped(
    @CurrentUser('id') userId: number,
    @Body() dto: BulkMarkCatalogOrdersShippedDto,
  ) {
    return this.orders.bulkMarkShipped(userId, dto);
  }

  @Get('orders/:id')
  getOrder(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.get(userId, id);
  }

  @Post('orders/:id/shipping-address')
  setOrderShippingAddress(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCatalogOrderShippingAddressDto,
  ) {
    return this.orders.setShippingAddress(userId, id, dto, { notifyCustomer: true });
  }

  @Post('orders/:id/ship')
  markOrderShipped(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkCatalogOrderShippedDto,
  ) {
    return this.orders.markShipped(userId, id, dto);
  }

  @Get('orders/:id/packing-slip.pdf')
  async packingSlipPdf(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const pdf = await this.orders.packingSlipPdf(userId, [id]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="packing-slip-${id}.pdf"`,
    );
    res.send(pdf);
  }

  @Post('orders/:id/deliver')
  markOrderDelivered(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.markDelivered(userId, id);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@CurrentUser('id') userId: number, @Body() dto: CreateCatalogOrderDto) {
    return this.orders.create(userId, dto);
  }

  @Post('orders/:id/screenshot')
  attachOrderScreenshot(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachCatalogOrderScreenshotDto,
  ) {
    return this.orders.attachScreenshot(userId, id, dto);
  }

  @Post('orders/:id/confirm')
  confirmOrder(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.confirm(userId, id);
  }

  @Post('orders/:id/reject')
  rejectOrder(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectCatalogOrderDto,
  ) {
    return this.orders.reject(userId, id, dto);
  }

  @Get('media')
  listMedia(@CurrentUser('id') userId: number) {
    return this.catalog.listMedia(userId);
  }

  @Post('media/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CATALOG_MAX_DOCUMENT_BYTES },
    }),
  )
  uploadMedia(
    @CurrentUser('id') userId: number,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
    @Body() body: { kind?: string; section_id?: string; alt?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    return this.catalog.uploadMedia(
      userId,
      {
        buffer: file.buffer,
        mimetype: file.mimetype,
        size: file.size,
        originalname: file.originalname,
      },
      {
        kind: body.kind,
        section_id: body.section_id ? Number(body.section_id) : undefined,
        alt: body.alt,
      },
    );
  }

  /** Draft preview — streams file for the authenticated owner. */
  @Get('media/:id/content')
  async mediaContent(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.catalog.getOwnerMediaFile(userId, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (file.kind === 'document' && file.fileName) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${file.fileName.replace(/"/g, '')}"`,
      );
    }
    res.send(file.buffer);
  }

  /** Time-limited HTTPS URL for WhatsApp image send / temporary share. */
  @Post('media/:id/signed-url')
  signedUrl(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('ttl_hours') ttlHoursRaw?: string,
  ) {
    const ttlHours = ttlHoursRaw ? parseInt(ttlHoursRaw, 10) : undefined;
    return this.catalog.createSignedMediaUrl(
      userId,
      id,
      Number.isFinite(ttlHours) ? ttlHours : undefined,
    );
  }

  @Patch('media/:id')
  updateMedia(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCatalogMediaDto,
  ) {
    return this.catalog.updateMedia(userId, id, dto);
  }

  @Delete('media/:id')
  deleteMedia(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.catalog.deleteMedia(userId, id);
  }
}
