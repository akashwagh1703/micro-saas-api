import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { WhatsAppApiService, WhatsAppApiResult } from '../integrations/whatsapp-api.service';
import { UpdateWhatsAppDto } from './dto/update-whatsapp.dto';

export interface DecryptedCredentials {
  account: WhatsAppAccount;
  accessToken: string | null;
  phoneNumberId: string | null;
  verifyToken: string | null;
  appSecret: string | null;
}

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly api: WhatsAppApiService,
    private readonly activity: ActivityLogger,
    private readonly config: ConfigService,
  ) {}

  private async firstOrCreate(userId: number): Promise<WhatsAppAccount> {
    const existing = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    return this.prisma.whatsAppAccount.create({ data: { userId } });
  }

  async credentials(userId: number): Promise<DecryptedCredentials | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account) {
      return null;
    }
    return {
      account,
      accessToken: this.crypto.decrypt(account.accessToken),
      phoneNumberId: account.phoneNumberId,
      verifyToken: this.crypto.decrypt(account.verifyToken),
      appSecret: this.crypto.decrypt(account.appSecret),
    };
  }

  async show(userId: number) {
    const account = await this.firstOrCreate(userId);
    const appUrl = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');

    return {
      account: {
        phone_number_id: account.phoneNumberId,
        business_account_id: account.businessAccountId,
        display_phone_number: account.displayPhoneNumber,
        is_connected: account.isConnected,
        connected_at: account.connectedAt ? account.connectedAt.toISOString() : null,
        has_access_token: !!account.accessToken,
        has_verify_token: !!account.verifyToken,
        has_app_secret: !!account.appSecret,
      },
      webhook_url: `${appUrl}/api/webhook/whatsapp/${userId}`,
    };
  }

  async update(userId: number, dto: UpdateWhatsAppDto) {
    await this.firstOrCreate(userId);

    const data: Record<string, any> = {};
    const setIf = (key: keyof UpdateWhatsAppDto, column: string, encrypt = false) => {
      const value = dto[key];
      if (value !== undefined && value !== null && value !== '') {
        data[column] = encrypt ? this.crypto.encrypt(value) : value;
      }
    };

    setIf('access_token', 'accessToken', true);
    setIf('phone_number_id', 'phoneNumberId');
    setIf('business_account_id', 'businessAccountId');
    setIf('verify_token', 'verifyToken', true);
    setIf('app_secret', 'appSecret', true);

    const account = await this.prisma.whatsAppAccount.update({ where: { userId }, data });

    await this.activity.log(userId, 'whatsapp_updated', 'WhatsApp credentials updated');

    return {
      message: 'Credentials saved',
      account: {
        phone_number_id: account.phoneNumberId,
        business_account_id: account.businessAccountId,
        is_connected: account.isConnected,
        display_phone_number: account.displayPhoneNumber,
      },
    };
  }

  async test(userId: number): Promise<{ body: WhatsAppApiResult; status: number }> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException();
    }

    const accessToken = this.crypto.decrypt(account.accessToken);
    const result = await this.api.testConnection(accessToken ?? '', account.phoneNumberId ?? '');

    if (result.success) {
      await this.prisma.whatsAppAccount.update({
        where: { userId },
        data: {
          isConnected: true,
          connectedAt: new Date(),
          displayPhoneNumber: result.data?.display_phone_number ?? account.displayPhoneNumber,
        },
      });
    }

    return { body: result, status: result.success ? 200 : 422 };
  }

  async disconnect(userId: number) {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException();
    }
    await this.prisma.whatsAppAccount.update({
      where: { userId },
      data: { isConnected: false, accessToken: null, connectedAt: null },
    });
    return { message: 'Disconnected' };
  }
}
