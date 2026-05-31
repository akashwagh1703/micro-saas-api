import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface InstagramApiResult {
  success: boolean;
  message?: string;
  data?: {
    page_id?: string;
    page_name?: string;
    instagram_user_id?: string;
    username?: string;
    display_name?: string;
    message_id?: string;
    recipient_id?: string;
  };
}

/** Meta Graph API client for Instagram Messaging (Page token + linked IG business account). */
@Injectable()
export class InstagramApiService {
  private readonly logger = new Logger(InstagramApiService.name);
  private readonly base: string;

  constructor(config: ConfigService) {
    const version = config.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    this.base = `https://graph.facebook.com/${version}`;
  }

  async testConnection(accessToken: string, pageId: string): Promise<InstagramApiResult> {
    if (!accessToken || !pageId) {
      return { success: false, message: 'Missing Page access token or Page ID' };
    }

    try {
      const pageResponse = await axios.get(`${this.base}/${pageId}`, {
        params: { fields: 'name,instagram_business_account' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (pageResponse.status < 200 || pageResponse.status >= 300) {
        return {
          success: false,
          message: pageResponse.data?.error?.message ?? 'Could not load Facebook Page',
        };
      }

      const igBusinessId = pageResponse.data?.instagram_business_account?.id;
      if (!igBusinessId) {
        return {
          success: false,
          message:
            'No Instagram Business account linked to this Page. Link Instagram to your Facebook Page in Meta Business Suite.',
        };
      }

      const igResponse = await axios.get(`${this.base}/${igBusinessId}`, {
        params: { fields: 'username,name' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (igResponse.status < 200 || igResponse.status >= 300) {
        return {
          success: false,
          message: igResponse.data?.error?.message ?? 'Could not load Instagram account',
        };
      }

      return {
        success: true,
        message: 'Instagram connected successfully',
        data: {
          page_id: pageId,
          page_name: pageResponse.data?.name ?? null,
          instagram_user_id: String(igBusinessId),
          username: igResponse.data?.username ?? null,
          display_name: igResponse.data?.name ?? null,
        },
      };
    } catch (e: any) {
      this.logger.error(`Instagram test connection failed: ${e.message}`);
      return { success: false, message: e.message };
    }
  }

  async fetchSenderProfile(
    accessToken: string,
    scopedUserId: string,
  ): Promise<{ name?: string; username?: string } | null> {
    if (!accessToken || !scopedUserId) {
      return null;
    }

    try {
      const response = await axios.get(`${this.base}/${scopedUserId}`, {
        params: { fields: 'name,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        return null;
      }

      return {
        name: response.data?.name ?? undefined,
        username: response.data?.username ?? undefined,
      };
    } catch {
      return null;
    }
  }

  async sendTextMessage(
    accessToken: string,
    instagramAccountId: string | null | undefined,
    recipientScopedId: string,
    text: string,
  ): Promise<InstagramApiResult> {
    if (!accessToken || !recipientScopedId || !text.trim()) {
      return { success: false, message: 'Missing credentials or message content' };
    }

    const body = {
      recipient: { id: recipientScopedId },
      message: { text },
    };

    const endpoints = instagramAccountId
      ? [`${this.base}/${instagramAccountId}/messages`, `${this.base}/me/messages`]
      : [`${this.base}/me/messages`];

    let lastError = 'Send failed';

    for (const url of endpoints) {
      try {
        const response = await axios.post(url, body, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
          validateStatus: () => true,
        });

        if (response.status >= 200 && response.status < 300) {
          return {
            success: true,
            data: {
              message_id: response.data?.message_id ?? response.data?.id ?? null,
              recipient_id: response.data?.recipient_id ?? recipientScopedId,
            },
          };
        }

        lastError = response.data?.error?.message ?? 'Instagram send failed';
        this.logger.warn(`Instagram send via ${url}: ${lastError}`);
      } catch (e: any) {
        lastError = e.message;
        this.logger.error(`Instagram send failed: ${e.message}`);
      }
    }

    return { success: false, message: lastError };
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
