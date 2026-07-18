import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export type PaymentMode = 'razorpay' | 'upi_manual' | 'both';

export interface PlatformUpiConfig {
  payment_mode: PaymentMode;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  upi_qr_url: string | null;
  upi_configured: boolean;
  monthly_inr: number;
  yearly_inr: number;
}

@Injectable()
export class PlatformUpiConfigService {
  private readonly logger = new Logger(PlatformUpiConfigService.name);
  private readonly qrRoot: string;

  constructor(private readonly config: ConfigService) {
    this.qrRoot =
      config.get<string>('PLATFORM_UPI_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'platform');
    const qrDir = path.join(this.qrRoot, 'upi');
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }
  }

  paymentMode(): PaymentMode {
    const raw = (this.config.get<string>('PAYMENT_MODE') ?? 'upi_manual').trim().toLowerCase();
    if (raw === 'razorpay' || raw === 'both') return raw as PaymentMode;
    return 'upi_manual';
  }

  isUpiManualEnabled(): boolean {
    const mode = this.paymentMode();
    return mode === 'upi_manual' || mode === 'both';
  }

  getPublicConfig(monthlyInr: number, yearlyInr: number): PlatformUpiConfig {
    const vpa = this.env('PLATFORM_UPI_VPA');
    const payee = this.env('PLATFORM_UPI_PAYEE_NAME') || 'AutoWave';
    const qrUrl = this.resolveQrUrl();
    return {
      payment_mode: this.paymentMode(),
      upi_vpa: vpa || null,
      upi_payee_name: payee || null,
      upi_qr_url: qrUrl,
      upi_configured: !!(vpa && qrUrl),
      monthly_inr: monthlyInr,
      yearly_inr: yearlyInr,
    };
  }

  assertUpiConfigured(): void {
    const cfg = this.getPublicConfig(0, 0);
    if (!cfg.upi_configured) {
      throw new UnprocessableEntityException(
        'UPI payments are not configured. Set PLATFORM_UPI_VPA and upload a QR code in admin.',
      );
    }
  }

  async saveQrImage(buffer: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw new Error('QR image must be JPEG, PNG, or WebP');
    }
    const filePath = path.join(this.qrRoot, 'upi', 'qr');
    await fs.promises.writeFile(filePath, buffer);
    this.logger.log('Platform UPI QR image updated');
    return this.buildPublicQrUrl();
  }

  async readQrImage(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const external = this.env('PLATFORM_UPI_QR_URL');
    if (external) {
      return null;
    }
    const filePath = path.join(this.qrRoot, 'upi', 'qr');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = await fs.promises.readFile(filePath);
    return { buffer, mimeType: this.guessMime(buffer) };
  }

  private resolveQrUrl(): string | null {
    const external = this.env('PLATFORM_UPI_QR_URL');
    if (external) return external;
    const filePath = path.join(this.qrRoot, 'upi', 'qr');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return this.buildPublicQrUrl();
  }

  private buildPublicQrUrl(): string {
    const base = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/public/platform/upi-qr`;
  }

  private env(key: string): string {
    return (this.config.get<string>(key) ?? '').trim();
  }

  private guessMime(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    return 'image/jpeg';
  }
}
