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
import {
  CreateCatalogProductDto,
  CreateCatalogSiteDto,
  ReorderCatalogSectionsDto,
  UpdateCatalogMediaDto,
  UpdateCatalogProductDto,
  UpdateCatalogSectionDto,
  UpdateCatalogSiteDto,
  UpdateCatalogSlugDto,
} from './dto/catalog.dto';
import { CATALOG_MAX_DOCUMENT_BYTES } from './catalog.constants';

@Controller('catalog')
@UseGuards(TokenAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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
