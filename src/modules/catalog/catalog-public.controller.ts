import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CatalogService } from './catalog.service';

/**
 * Public catalog brochure — no auth, no AutoWave branding in payload.
 *
 * Routes (order matters — static paths before :slug):
 *   GET /api/public/catalog/media/:id
 *   GET /api/public/catalog/file?token=
 *   GET /api/public/catalog/:slug
 */
@Controller('public/catalog')
export class CatalogPublicController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('media/:id')
  async getMedia(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.catalog.getPublishedMediaFile(id);
    this.sendFile(res, file);
  }

  @Get('file')
  async getSignedFile(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!token?.trim()) {
      throw new NotFoundException('Invalid or expired link');
    }
    const file = await this.catalog.getSignedMediaFile(token.trim());
    this.sendFile(res, file);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.catalog.getPublicBySlug(slug);
  }

  private sendFile(
    res: Response,
    file: { buffer: Buffer; mimeType: string; fileName: string | null; kind: string },
  ): void {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (file.kind === 'document' && file.fileName) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${file.fileName.replace(/"/g, '')}"`,
      );
    }
    res.send(file.buffer);
  }
}
