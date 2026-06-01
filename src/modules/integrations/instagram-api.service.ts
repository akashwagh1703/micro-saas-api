import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { withMetaApiRetry } from '../../common/meta-api-retry';
import {
  metaAccessTokenHint,
  metaPageIdHint,
  normalizeMetaAccessToken,
} from '../../common/meta-token';

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

interface GraphPagePayload {
  id?: string;
  name?: string;
  instagram_business_account?: { id?: string };
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

  private graphGet<T = any>(path: string, accessToken: string, params?: Record<string, string>) {
    const config: AxiosRequestConfig = {
      params,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
      validateStatus: () => true,
    };
    return axios.get<T>(`${this.base}/${path}`, config);
  }

  private async resolveLinkedPage(
    accessToken: string,
    pageId: string,
  ): Promise<{ page: GraphPagePayload | null; error?: string }> {
    const meResponse = await this.graphGet<GraphPagePayload>('me', accessToken, {
      fields: 'id,name,instagram_business_account',
    });

    if (meResponse.status >= 200 && meResponse.status < 300 && meResponse.data?.instagram_business_account?.id) {
      return { page: meResponse.data };
    }

    if (pageId) {
      const pageResponse = await this.graphGet<GraphPagePayload>(pageId, accessToken, {
        fields: 'id,name,instagram_business_account',
      });

      if (pageResponse.status >= 200 && pageResponse.status < 300) {
        return { page: pageResponse.data };
      }

      const graphError = (pageResponse.data as { error?: { message?: string } })?.error?.message;
      if (graphError?.toLowerCase().includes('nonexisting field (instagram_business_account)')) {
        const igProbe = await this.graphGet(pageId, accessToken, { fields: 'username,name' });
        if (igProbe.status >= 200 && igProbe.status < 300 && igProbe.data?.username) {
          return {
            page: null,
            error:
              'You entered an Instagram account ID. WhatsFlow needs the Facebook Page ID linked to that Instagram account.',
          };
        }
      }

      return {
        page: null,
        error: metaPageIdHint(graphError) ?? metaAccessTokenHint(graphError) ?? 'Could not load Facebook Page',
      };
    }

    const graphError = (meResponse.data as { error?: { message?: string } })?.error?.message;
    return {
      page: null,
      error:
        metaPageIdHint(graphError) ??
        metaAccessTokenHint(graphError) ??
        'Could not resolve Facebook Page from token. Paste your Facebook Page ID (not Instagram ID).',
    };
  }

  async testConnection(accessToken: string, pageId: string): Promise<InstagramApiResult> {
    accessToken = normalizeMetaAccessToken(accessToken);
    if (!accessToken) {
      return { success: false, message: 'Missing Page access token' };
    }

    if (!/^[A-Za-z0-9|._-]+$/.test(accessToken)) {
      return {
        success: false,
        message: metaAccessTokenHint('Invalid OAuth access token - Cannot parse access token'),
      };
    }

    try {
      const resolved = await this.resolveLinkedPage(accessToken, pageId);
      if (!resolved.page) {
        return { success: false, message: resolved.error ?? 'Could not load Facebook Page' };
      }

      const igBusinessId = resolved.page.instagram_business_account?.id;
      if (!igBusinessId) {
        return {
          success: false,
          message:
            'No Instagram Business account linked to this Page. Link Instagram to your Facebook Page in Meta Business Suite.',
        };
      }

      const resolvedPageId = String(resolved.page.id ?? pageId);
      const igResponse = await this.graphGet(igBusinessId, accessToken, { fields: 'username,name' });

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
          page_id: resolvedPageId,
          page_name: resolved.page.name,
          instagram_user_id: String(igBusinessId),
          username: igResponse.data?.username ?? undefined,
          display_name: igResponse.data?.name ?? undefined,
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
      const response = await withMetaApiRetry(() =>
        this.graphGet(scopedUserId, accessToken, { fields: 'name,username' }),
      );
      if (response.status < 200 || response.status >= 300) {
        return null;
      }
      return {
        name: response.data?.name,
        username: response.data?.username,
      };
    } catch {
      return null;
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
              message_id: response.data?.message_id ?? response.data?.id ?? undefined,
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
}
