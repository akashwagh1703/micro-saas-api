import { Injectable } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import type { SendMailResult } from '../../mail/mail.types';

export interface CareerEmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class CareerEmailService {
  constructor(private readonly mail: MailService) {}

  isEnabled(): boolean {
    return this.mail.isEnabled();
  }

  async send(payload: CareerEmailPayload): Promise<{ success: boolean; error?: string }> {
    const result: SendMailResult = await this.mail.send(payload);
    return result.success
      ? { success: true }
      : { success: false, error: result.error ?? 'send_failed' };
  }
}
