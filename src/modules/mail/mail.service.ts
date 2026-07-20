import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import type { MailDriver, SendMailInput, SendMailResult } from './mail.types';

const BREVO_SMTP_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

function recipientsToList(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return list.map((addr) => addr.trim()).filter(Boolean);
}

/** Parse `Name <email@x.com>` or bare email into Brevo sender fields. */
export function parseFromAddress(raw: string): { email: string; name?: string } {
  const trimmed = raw.trim();
  const angled = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, '').trim();
    return { email: angled[2].trim(), ...(name ? { name } : {}) };
  }
  return { email: trimmed };
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private driver: MailDriver = 'log';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.driver = this.resolveDriver();
    if (this.driver === 'log') {
      this.logger.warn(
        'Mail driver is "log" — emails will be written to logs only (set MAIL_DRIVER=brevo|smtp and credentials to send)',
      );
    } else {
      this.logger.log(`Mail driver: ${this.driver}`);
    }
  }

  /** Active transport after env resolution. */
  getDriver(): MailDriver {
    return this.driver;
  }

  /** True when a real transport (Brevo or SMTP) is active — not log-only. */
  isEnabled(): boolean {
    return this.driver === 'brevo' || this.driver === 'smtp';
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const to = recipientsToList(input.to);
    if (to.length === 0) {
      return { success: false, error: 'no_recipients', driver: this.driver };
    }

    const html = input.html ?? input.text.replace(/\n/g, '<br>');

    try {
      switch (this.driver) {
        case 'brevo':
          return await this.sendViaBrevo({ ...input, to, html });
        case 'smtp':
          return await this.sendViaSmtp({ ...input, to, html });
        default:
          return this.sendViaLog({ ...input, to, html });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Mail send failed driver=${this.driver} to=${to.join(',')}: ${message}`);
      return { success: false, error: message, driver: this.driver };
    }
  }

  private resolveDriver(): MailDriver {
    const explicit = this.config.get<string>('MAIL_DRIVER')?.trim().toLowerCase();
    if (explicit === 'brevo' || explicit === 'smtp' || explicit === 'log') {
      if (explicit === 'brevo' && !this.brevoApiKey()) {
        this.logger.warn('MAIL_DRIVER=brevo but BREVO_API_KEY is empty — falling back to log');
        return 'log';
      }
      if (explicit === 'smtp' && !this.smtpHost()) {
        this.logger.warn('MAIL_DRIVER=smtp but SMTP_HOST is empty — falling back to log');
        return 'log';
      }
      return explicit;
    }

    // auto: prefer Brevo, then SMTP, else log
    if (this.brevoApiKey()) return 'brevo';
    if (this.smtpHost()) return 'smtp';
    return 'log';
  }

  private brevoApiKey(): string | undefined {
    return this.config.get<string>('BREVO_API_KEY')?.trim() || undefined;
  }

  private smtpHost(): string | undefined {
    return this.config.get<string>('SMTP_HOST')?.trim() || undefined;
  }

  private fromRaw(): string {
    return (
      this.config.get<string>('MAIL_FROM')?.trim() ||
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      'noreply@autowave.local'
    );
  }

  private fromName(): string | undefined {
    return this.config.get<string>('MAIL_FROM_NAME')?.trim() || undefined;
  }

  private sender(): { email: string; name?: string } {
    const parsed = parseFromAddress(this.fromRaw());
    const name = this.fromName() ?? parsed.name;
    return name ? { email: parsed.email, name } : { email: parsed.email };
  }

  private sendViaLog(input: SendMailInput & { to: string[]; html: string }): SendMailResult {
    this.logger.log(
      `[mail:log] to=${input.to.join(',')} subject=${JSON.stringify(input.subject)} text=${JSON.stringify(input.text.slice(0, 500))}`,
    );
    return { success: true, driver: 'log' };
  }

  private async sendViaSmtp(
    input: SendMailInput & { to: string[]; html: string },
  ): Promise<SendMailResult> {
    const transport = this.getSmtpTransporter();
    if (!transport) {
      this.logger.warn(`SMTP not configured — skipped email to ${input.to.join(',')}`);
      return { success: false, error: 'smtp_not_configured', driver: 'smtp' };
    }

    const sender = this.sender();
    const from = sender.name ? `"${sender.name}" <${sender.email}>` : sender.email;

    await transport.sendMail({
      from,
      to: input.to.join(', '),
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
    });

    return { success: true, driver: 'smtp' };
  }

  private getSmtpTransporter(): nodemailer.Transporter | null {
    if (!this.smtpHost()) return null;
    if (!this.transporter) {
      const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost(),
        port: Number.isNaN(port) ? 587 : port,
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
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

  private async sendViaBrevo(
    input: SendMailInput & { to: string[]; html: string },
  ): Promise<SendMailResult> {
    const apiKey = this.brevoApiKey();
    if (!apiKey) {
      this.logger.warn(`Brevo not configured — skipped email to ${input.to.join(',')}`);
      return { success: false, error: 'brevo_not_configured', driver: 'brevo' };
    }

    const sender = this.sender();
    const body: Record<string, unknown> = {
      sender,
      to: input.to.map((email) => ({ email })),
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
    };
    if (input.replyTo) {
      body.replyTo = { email: input.replyTo };
    }

    await axios.post(BREVO_SMTP_EMAIL_URL, body, {
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      timeout: 15_000,
    });

    return { success: true, driver: 'brevo' };
  }
}
