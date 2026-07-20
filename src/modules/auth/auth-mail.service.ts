import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private portalUrl(path: string): string {
    const base = this.config.get<string>('PORTAL_URL')?.replace(/\/$/, '') ?? '';
    if (!base) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  verifyEmailUrl(plainToken: string): string {
    return this.portalUrl(`/verify-email?token=${encodeURIComponent(plainToken)}`);
  }

  resetPasswordUrl(plainToken: string): string {
    return this.portalUrl(`/reset-password?token=${encodeURIComponent(plainToken)}`);
  }

  /** Welcome + verify CTA (sent on register). */
  async sendWelcome(params: {
    to: string;
    name: string;
    verifyUrl?: string;
  }): Promise<void> {
    const subject = 'Welcome to AutoWave';
    const verifyBlock = params.verifyUrl
      ? [
          '',
          'Please confirm your email address:',
          params.verifyUrl,
          '',
          'This link expires in 48 hours.',
        ]
      : [];
    const text = [
      `Hi ${params.name},`,
      '',
      'Welcome to AutoWave — you can start setting up WhatsApp auto-replies and bookings right away.',
      ...verifyBlock,
      '',
      this.portalUrl('/dashboard')
        ? `Open your portal: ${this.portalUrl('/dashboard')}`
        : 'Sign in to your portal to get started.',
      '',
      '— AutoWave',
    ].join('\n');

    const html = `
<p>Hi ${escapeHtml(params.name)},</p>
<p>Welcome to AutoWave — you can start setting up WhatsApp auto-replies and bookings right away.</p>
${
  params.verifyUrl
    ? `<p><a href="${escapeHtml(params.verifyUrl)}">Confirm your email address</a></p>
<p style="color:#64748b;font-size:13px">This link expires in 48 hours.</p>`
    : ''
}
<p><a href="${escapeHtml(this.portalUrl('/dashboard'))}">Open your portal</a></p>
<p>— AutoWave</p>`;

    await this.sendSafe(params.to, subject, text, html);
  }

  /** Dedicated verification email (resend). */
  async sendEmailVerification(params: {
    to: string;
    name: string;
    verifyUrl: string;
  }): Promise<void> {
    const subject = 'Confirm your AutoWave email';
    const text = [
      `Hi ${params.name},`,
      '',
      'Confirm your email address for AutoWave:',
      params.verifyUrl,
      '',
      'This link expires in 48 hours. If you did not create an account, you can ignore this email.',
      '',
      '— AutoWave',
    ].join('\n');

    const html = `
<p>Hi ${escapeHtml(params.name)},</p>
<p>Confirm your email address for AutoWave:</p>
<p><a href="${escapeHtml(params.verifyUrl)}">Verify email</a></p>
<p style="color:#64748b;font-size:13px">This link expires in 48 hours. If you did not create an account, you can ignore this email.</p>
<p>— AutoWave</p>`;

    await this.sendSafe(params.to, subject, text, html);
  }

  async sendPasswordReset(params: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<void> {
    const subject = 'Reset your AutoWave password';
    const text = [
      `Hi ${params.name},`,
      '',
      'We received a request to reset your AutoWave password.',
      'Open this link to choose a new password (expires in 1 hour):',
      params.resetUrl,
      '',
      'If you did not request this, you can ignore this email — your password will stay the same.',
      '',
      '— AutoWave',
    ].join('\n');

    const html = `
<p>Hi ${escapeHtml(params.name)},</p>
<p>We received a request to reset your AutoWave password.</p>
<p><a href="${escapeHtml(params.resetUrl)}">Reset password</a></p>
<p style="color:#64748b;font-size:13px">This link expires in 1 hour. If you did not request this, ignore this email.</p>
<p>— AutoWave</p>`;

    await this.sendSafe(params.to, subject, text, html);
  }

  private async sendSafe(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const result = await this.mail.send({ to, subject, text, html });
    if (!result.success) {
      this.logger.warn(`Auth email failed to=${to} subject=${subject}: ${result.error ?? 'unknown'}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
