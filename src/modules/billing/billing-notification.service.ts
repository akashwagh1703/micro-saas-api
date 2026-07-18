import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class BillingNotificationService {
  private readonly logger = new Logger(BillingNotificationService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('SMTP_HOST')?.trim();
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.isEnabled()) return null;
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

  private portalBillingUrl(): string {
    const portal = this.config.get<string>('PORTAL_URL')?.replace(/\/$/, '');
    return portal ? `${portal}/settings/billing` : '';
  }

  private async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const transport = this.getTransporter();
    if (!transport) {
      this.logger.warn(`SMTP not configured — skipped billing email to ${to}`);
      return;
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ??
      this.config.get<string>('SMTP_USER')?.trim() ??
      'noreply@autowave.local';

    try {
      await transport.sendMail({
        from,
        to,
        subject,
        text,
        html: html ?? text.replace(/\n/g, '<br>'),
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Billing email failed to=${to}: ${message}`);
    }
  }

  async notifyPaymentApproved(params: {
    to: string;
    name: string;
    plan: string;
    amountInr: number;
    periodEnd: Date;
  }) {
    const billingUrl = this.portalBillingUrl();
    const period = params.periodEnd.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const subject = 'AutoWave — UPI payment approved';
    const text = [
      `Hi ${params.name},`,
      '',
      `Your UPI payment of ₹${params.amountInr} for the ${params.plan} plan was verified.`,
      `Your subscription is active until ${period}.`,
      '',
      billingUrl ? `Manage billing: ${billingUrl}` : 'You can go live on your auto-replies now.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
  }

  async notifyPaymentRejected(params: {
    to: string;
    name: string;
    plan: string;
    reason: string;
  }) {
    const billingUrl = this.portalBillingUrl();
    const subject = 'AutoWave — UPI payment could not be verified';
    const text = [
      `Hi ${params.name},`,
      '',
      `We could not verify your UPI payment for the ${params.plan} plan.`,
      `Reason: ${params.reason}`,
      '',
      billingUrl
        ? `You can submit again from Plan & billing: ${billingUrl}`
        : 'Please submit payment proof again from Plan & billing in the portal.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
  }

  async notifyPaymentExpired(params: { to: string; name: string; plan: string }) {
    const billingUrl = this.portalBillingUrl();
    const subject = 'AutoWave — payment verification expired';
    const text = [
      `Hi ${params.name},`,
      '',
      `Your UPI payment submission for the ${params.plan} plan was not verified in time and has expired.`,
      billingUrl
        ? `Please pay again and submit proof: ${billingUrl}`
        : 'Please pay again and submit proof from Plan & billing.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
  }

  async notifyAdminDuplicateUtr(params: {
    utr: string;
    userId: number;
    userEmail: string;
  }) {
    const salesEmail = this.config.get<string>('SALES_EMAIL')?.trim();
    if (!salesEmail) return;

    const subject = `AutoWave — duplicate UPI UTR attempt (${params.utr})`;
    const text = [
      'A tenant tried to submit a UPI transaction ID that is already on file.',
      '',
      `UTR: ${params.utr}`,
      `User: ${params.userEmail} (id ${params.userId})`,
      '',
      'Review in Platform admin → UPI payments if needed.',
    ].join('\n');

    await this.send(salesEmail, subject, text);
  }
}
