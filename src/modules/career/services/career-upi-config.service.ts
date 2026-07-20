import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CareerTenantSettingsService } from './career-tenant-settings.service';

export type SeekerPaymentMode = 'razorpay' | 'upi_manual' | 'both';

export interface CareerUpiPublicConfig {
  payment_mode: SeekerPaymentMode;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  upi_qr_url: string | null;
  upi_configured: boolean;
  monthly_inr: number;
  yearly_inr: number;
}

@Injectable()
export class CareerUpiConfigService {
  private readonly logger = new Logger(CareerUpiConfigService.name);
  private readonly qrRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tenantSettings: CareerTenantSettingsService,
  ) {
    this.qrRoot =
      config.get<string>('CAREER_UPI_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'career-upi');
    if (!fs.existsSync(this.qrRoot)) {
      fs.mkdirSync(this.qrRoot, { recursive: true });
    }
  }

  async getPublicConfig(tenantUserId: number): Promise<CareerUpiPublicConfig> {
    const billing = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    const qrUrl = this.resolveQrUrl(tenantUserId);
    return {
      payment_mode: billing.paymentMode,
      upi_vpa: billing.upiVpa || null,
      upi_payee_name: billing.upiPayeeName || null,
      upi_qr_url: qrUrl,
      upi_configured: !!(billing.upiVpa && qrUrl),
      monthly_inr: billing.priceMonthlyInr,
      yearly_inr: billing.priceYearlyInr,
    };
  }

  async assertUpiConfigured(tenantUserId: number): Promise<void> {
    const cfg = await this.getPublicConfig(tenantUserId);
    if (!cfg.upi_configured) {
      throw new UnprocessableEntityException(
        'CareerAI UPI is not configured. Set UPI ID and upload a QR code in Settings → CareerAI.',
      );
    }
  }

  async saveQrImage(tenantUserId: number, buffer: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw new Error('QR image must be JPEG, PNG, or WebP');
    }
    const dir = path.join(this.qrRoot, String(tenantUserId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(path.join(dir, 'qr'), buffer);
    this.logger.log(`CareerAI UPI QR updated tenantUserId=${tenantUserId}`);
    return this.buildTenantQrUrl(tenantUserId);
  }

  async readQrImage(tenantUserId: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const filePath = path.join(this.qrRoot, String(tenantUserId), 'qr');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = await fs.promises.readFile(filePath);
    return { buffer, mimeType: this.guessMime(buffer) };
  }

  buildPublicSeekerQrUrl(token: string): string {
    const base = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/career/public/billing/upi-qr?token=${encodeURIComponent(token)}`;
  }

  private buildTenantQrUrl(tenantUserId: number): string {
    const base = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/career/billing/upi-qr`;
  }

  private resolveQrUrl(tenantUserId: number): string | null {
    const filePath = path.join(this.qrRoot, String(tenantUserId), 'qr');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return this.buildTenantQrUrl(tenantUserId);
  }

  resolveSeekerQrUrl(tenantUserId: number, portalToken: string): string | null {
    const filePath = path.join(this.qrRoot, String(tenantUserId), 'qr');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return this.buildPublicSeekerQrUrl(portalToken);
  }

  private guessMime(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    return 'image/jpeg';
  }
}
