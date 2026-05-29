import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface WhatsAppApiResult {
  success: boolean;
  message?: string;
  data?: any;
}

/** Thin client for the Meta WhatsApp Cloud API (Graph API). */
@Injectable()
export class WhatsAppApiService {
  private readonly logger = new Logger(WhatsAppApiService.name);
  private readonly base: string;

  constructor(config: ConfigService) {
    const version = config.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    this.base = `https://graph.facebook.com/${version}`;
  }

  async testConnection(accessToken: string, phoneNumberId: string): Promise<WhatsAppApiResult> {
    if (!accessToken || !phoneNumberId) {
      return { success: false, message: 'Missing credentials' };
    }

    try {
      const response = await axios.get(`${this.base}/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        return { success: true, message: 'Connected successfully', data: response.data };
      }

      return {
        success: false,
        message: response.data?.error?.message ?? 'Connection failed',
      };
    } catch (e: any) {
      this.logger.error(`WhatsApp test connection failed: ${e.message}`);
      return { success: false, message: e.message };
    }
  }

  async sendTextMessage(
    accessToken: string,
    phoneNumberId: string,
    to: string,
    text: string,
  ): Promise<WhatsAppApiResult> {
    const phone = (to ?? '').replace(/\D/g, '');

    try {
      const response = await axios.post(
        `${this.base}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: text },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 20000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.data };
      }

      return { success: false, message: response.data?.error?.message ?? 'Send failed' };
    } catch (e: any) {
      this.logger.error(`WhatsApp send failed: ${e.message}`);
      return { success: false, message: e.message };
    }
  }

  verifyWebhookSignature(payload: string, signature: string | undefined, appSecret: string): boolean {
    if (!signature || !appSecret) {
      return false;
    }
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
