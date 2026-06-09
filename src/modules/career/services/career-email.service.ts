import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface CareerEmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class CareerEmailService {
  private readonly logger = new Logger(CareerEmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('SMTP_HOST')?.trim();
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.isEnabled()) {
      return null;
    }
    if (!this.transporter) {
      const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: Number.isNaN(port) ? 587 : port,
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: this.config.get<string>('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
      });
    }
    return this.transporter;
  }

  async send(payload: CareerEmailPayload): Promise<{ success: boolean; error?: string }> {
    const transport = this.getTransporter();
    if (!transport) {
      return { success: false, error: 'smtp_not_configured' };
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ??
      this.config.get<string>('SMTP_USER')?.trim() ??
      'noreply@autowave.local';

    try {
      await transport.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html ?? payload.text.replace(/\n/g, '<br>'),
      });
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Career email send failed to=${payload.to}: ${message}`);
      return { success: false, error: message };
    }
  }
}
