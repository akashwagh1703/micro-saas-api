import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

const ENCRYPTED_KEYS = ['openrouter_api_key', 'openai_api_key'];

/** Per-user key/value settings, with at-rest encryption for API keys. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(userId: number, key: string, fallback: string | null = null): Promise<string | null> {
    const setting = await this.prisma.userSetting.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!setting) {
      return fallback;
    }

    if (setting.isEncrypted && setting.value) {
      return this.crypto.decrypt(setting.value) ?? fallback;
    }

    return setting.value ?? fallback;
  }

  async set(userId: number, key: string, value: string | null) {
    const isEncrypted = ENCRYPTED_KEYS.includes(key);
    let storedValue = value;

    if (isEncrypted && value) {
      storedValue = this.crypto.encrypt(value);
    }

    return this.prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      update: { value: storedValue, isEncrypted },
      create: { userId, key, value: storedValue, isEncrypted },
    });
  }

  async getMany(userId: number, keys: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      result[key] = await this.get(userId, key);
    }
    return result;
  }
}
