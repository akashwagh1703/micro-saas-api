import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { currentBusinessPublishedWhere, parseUseCases } from '../../common/workflow-scope';
import { verticalProfileFields } from '../../platform/business-verticals.registry';
import { businessLabel, useCaseLabel } from '../workflows/business-workflow';

const ENCRYPTED_KEYS = [
  'openrouter_api_key',
  'openai_api_key',
  'lead_api_bearer_token',
  'career_adzuna_app_key',
  'career_jsearch_rapidapi_key',
  'career_linkedin_jobs_api_key',
  'career_naukri_jobs_api_key',
  'career_razorpay_key_secret',
  'career_razorpay_webhook_secret',
];

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

  /** Portal business profile — shared by GET /settings/business-profile and setup-business. */
  async getBusinessProfile(userId: number) {
    const settings = await this.getMany(userId, [
      'business_category',
      'use_cases',
      'use_case',
      'business_description',
    ]);
    const use_cases = parseUseCases(settings);
    const business_category = settings.business_category ?? null;

    let published_count = 0;
    if (business_category) {
      published_count = await this.prisma.workflow.count({
        where: currentBusinessPublishedWhere(userId, business_category),
      });
    }

    return {
      business_category,
      use_cases,
      business_description: settings.business_description ?? null,
      business_label: business_category ? businessLabel(business_category) : null,
      use_case_labels: use_cases.map((uc) => useCaseLabel(uc)),
      configured:
        !!business_category &&
        (business_category === 'career_ai' || use_cases.length > 0),
      published_count,
      can_change_business: published_count === 0,
      ...verticalProfileFields(business_category),
    };
  }
}
