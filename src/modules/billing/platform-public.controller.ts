import { Body, Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PlatformUpiConfigService } from './platform-upi-config.service';

/** Public UPI QR image for tenant subscription payments. */
@Controller('public/platform')
export class PlatformPublicController {
  constructor(private readonly upiConfig: PlatformUpiConfigService) {}

  @Get('upi-qr')
  async upiQr(@Res() res: Response): Promise<void> {
    const file = await this.upiConfig.readQrImage();
    if (!file) {
      res.status(404).json({ message: 'UPI QR not configured' });
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(file.buffer);
  }
}
