import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { TenantBrandingService } from './tenant-branding.service';

/** Public HTTPS URLs for WhatsApp to fetch tenant welcome images. */
@Controller('public/branding')
export class BrandingPublicController {
  constructor(private readonly branding: TenantBrandingService) {}

  @Get(':userId/:token/welcome')
  async welcomeImage(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.branding.readWelcomeImageIfAuthorized(userId, token);
    if (!file) {
      throw new NotFoundException();
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(file.buffer);
  }
}
