import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstagramAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { InstagramApiService, InstagramApiResult } from '../integrations/instagram-api.service';
import { INSTAGRAM_SETUP_GUIDE } from './instagram-setup.guide';
import { UpdateInstagramDto } from './dto/update-instagram.dto';
import {
  metaAccessTokenHint,
  normalizeMetaAccessToken,
  normalizeMetaPageId,
} from '../../common/meta-token';

export interface DecryptedInstagramCredentials {
  account: InstagramAccount;
  accessToken: string | null;
  pageId: string | null;
  verifyToken: string | null;
  appSecret: string | null;
}

@Injectable()
export class InstagramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly api: InstagramApiService,
    private readonly activity: ActivityLogger,
    private readonly config: ConfigService,
  ) {}

  private async firstOrCreate(userId: number): Promise<InstagramAccount> {
    const existing = await this.prisma.instagramAccount.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    return this.prisma.instagramAccount.create({ data: { userId } });
  }

  async credentials(userId: number): Promise<DecryptedInstagramCredentials | null> {
    const account = await this.prisma.instagramAccount.findUnique({ where: { userId } });
    if (!account) {
      return null;
    }
    return {
      account,
      accessToken: this.crypto.decrypt(account.accessToken),
      pageId: account.pageId,
      verifyToken: this.crypto.decrypt(account.verifyToken),
      appSecret: this.crypto.decrypt(account.appSecret),
    };
  }

  setupGuide(userId: number) {
    const appUrl = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
    return {
      ...INSTAGRAM_SETUP_GUIDE,
      webhook_url: `${appUrl}/api/webhook/instagram/${userId}`,
      docs_path: 'docs/INSTAGRAM_SETUP.md',
    };
  }

  async show(userId: number) {
    const account = await this.firstOrCreate(userId);
    const appUrl = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');

    return {
      account: {
        page_id: account.pageId,
        instagram_user_id: account.instagramUserId,
        username: account.username,
        display_name: account.displayName,
        is_connected: account.isConnected,
        connected_at: account.connectedAt ? account.connectedAt.toISOString() : null,
        has_access_token: !!account.accessToken,
        has_verify_token: !!account.verifyToken,
        has_app_secret: !!account.appSecret,
      },
      webhook_url: `${appUrl}/api/webhook/instagram/${userId}`,
      setup: this.setupGuide(userId),
    };
  }

  async update(userId: number, dto: UpdateInstagramDto) {
    await this.firstOrCreate(userId);

    const data: Record<string, any> = {};
    const setIf = (key: keyof UpdateInstagramDto, column: string, encrypt = false) => {
      const value = dto[key];
      if (value !== undefined && value !== null && value !== '') {
        data[column] = encrypt ? this.crypto.encrypt(value) : value;
      }
    };

    if (dto.access_token !== undefined && dto.access_token !== null && dto.access_token !== '') {
      data.accessToken = this.crypto.encrypt(normalizeMetaAccessToken(dto.access_token));
    }
    if (dto.page_id !== undefined && dto.page_id !== null && dto.page_id !== '') {
      data.pageId = normalizeMetaPageId(dto.page_id);
    }
    setIf('instagram_user_id', 'instagramUserId');
    setIf('username', 'username');
    setIf('display_name', 'displayName');
    setIf('app_secret', 'appSecret', true);

    if (dto.verify_token !== undefined && dto.verify_token !== null && dto.verify_token !== '') {
      data.verifyToken = this.crypto.encrypt(String(dto.verify_token).trim());
    }

    const account = await this.prisma.instagramAccount.update({ where: { userId }, data });

    await this.activity.log(userId, 'instagram_updated', 'Instagram credentials updated');

    return {
      message: 'Credentials saved',
      account: {
        page_id: account.pageId,
        instagram_user_id: account.instagramUserId,
        username: account.username,
        display_name: account.displayName,
        is_connected: account.isConnected,
      },
    };
  }

  async test(userId: number): Promise<{ body: InstagramApiResult; status: number }> {
    const account = await this.prisma.instagramAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException();
    }

    const accessToken = normalizeMetaAccessToken(this.crypto.decrypt(account.accessToken));
    const pageId = normalizeMetaPageId(account.pageId);
    const result = await this.api.testConnection(accessToken, pageId);

    if (!result.success && result.message) {
      result.message = metaAccessTokenHint(result.message) ?? result.message;
    }

    if (result.success && result.data) {
      await this.prisma.instagramAccount.update({
        where: { userId },
        data: {
          isConnected: true,
          connectedAt: new Date(),
          pageId: result.data.page_id ?? account.pageId,
          instagramUserId: result.data.instagram_user_id ?? account.instagramUserId,
          username: result.data.username ?? account.username,
          displayName: result.data.display_name ?? account.displayName,
        },
      });
    }

    return { body: result, status: result.success ? 200 : 422 };
  }

  async disconnect(userId: number) {
    const account = await this.prisma.instagramAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException();
    }
    await this.prisma.instagramAccount.update({
      where: { userId },
      data: {
        isConnected: false,
        accessToken: null,
        connectedAt: null,
      },
    });
    return { message: 'Disconnected' };
  }
}
