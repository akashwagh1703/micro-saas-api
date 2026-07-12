import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { currentBusinessPublishedWhere, parseUseCases } from '../../common/workflow-scope';
import { verticalProfileFields } from '../../platform/business-verticals.registry';
import {
  APPOINTMENT_SERVICES_SETTING_KEY,
  AppointmentServiceOption,
  SALON_SERVICES_SETTING_KEY,
  defaultServicesForVertical,
  isSchedulingVertical,
  parseAppointmentServicesJson,
  validateAppointmentServices,
} from '../../platform/appointment-services';
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
      'business_name',
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
      business_name: settings.business_name ?? null,
      business_label: business_category ? businessLabel(business_category) : null,
      use_case_labels: use_cases.map((uc) => useCaseLabel(uc)),
      configured:
        !!business_category &&
        (business_category === 'career_ai' || use_cases.length > 0),
      published_count,
      can_change_business: published_count === 0,
      appointment_services: isSchedulingVertical(business_category)
        ? await this.getAppointmentServices(userId)
        : null,
      /** @deprecated use appointment_services */
      salon_services: isSchedulingVertical(business_category)
        ? await this.getAppointmentServices(userId)
        : null,
      ...verticalProfileFields(business_category),
    };
  }

  async getAppointmentServices(userId: number): Promise<AppointmentServiceOption[]> {
    const category = await this.get(userId, 'business_category');
    if (isSchedulingVertical(category)) {
      await this.ensureAppointmentServicesDefaults(userId, category);
    }
    const raw =
      (await this.get(userId, APPOINTMENT_SERVICES_SETTING_KEY)) ??
      (await this.get(userId, SALON_SERVICES_SETTING_KEY));
    return parseAppointmentServicesJson(raw, category);
  }

  async setAppointmentServices(userId: number, services: unknown): Promise<AppointmentServiceOption[]> {
    const category = await this.get(userId, 'business_category');
    if (!isSchedulingVertical(category)) {
      throw new UnprocessableEntityException({
        message: 'Appointment services are only available for businesses with live scheduling.',
        errors: {
          business_category: ['Configure a scheduling-enabled business type first.'],
        },
      });
    }
    const { valid, services: normalized, errors } = validateAppointmentServices(services);
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { appointment_services: errors },
      });
    }
    const json = JSON.stringify(normalized);
    await this.set(userId, APPOINTMENT_SERVICES_SETTING_KEY, json);
    if (category === 'salon') {
      await this.set(userId, SALON_SERVICES_SETTING_KEY, json);
    }
    return normalized;
  }

  /** Seed vertical defaults on first setup / first load. */
  async ensureAppointmentServicesDefaults(
    userId: number,
    businessCategory?: string | null,
  ): Promise<void> {
    const category = businessCategory ?? (await this.get(userId, 'business_category'));
    if (!isSchedulingVertical(category)) return;

    const existing =
      (await this.get(userId, APPOINTMENT_SERVICES_SETTING_KEY)) ??
      (await this.get(userId, SALON_SERVICES_SETTING_KEY));
    if (existing) {
      if (!(await this.get(userId, APPOINTMENT_SERVICES_SETTING_KEY))) {
        await this.set(userId, APPOINTMENT_SERVICES_SETTING_KEY, existing);
      }
      return;
    }

    const defaults = defaultServicesForVertical(category);
    const json = JSON.stringify(defaults);
    await this.set(userId, APPOINTMENT_SERVICES_SETTING_KEY, json);
    if (category === 'salon') {
      await this.set(userId, SALON_SERVICES_SETTING_KEY, json);
    }
  }

  /** @deprecated Use getAppointmentServices */
  async getSalonServices(userId: number): Promise<AppointmentServiceOption[]> {
    return this.getAppointmentServices(userId);
  }

  /** @deprecated Use setAppointmentServices */
  async setSalonServices(userId: number, services: unknown): Promise<AppointmentServiceOption[]> {
    return this.setAppointmentServices(userId, services);
  }

  /** @deprecated Use ensureAppointmentServicesDefaults */
  async ensureSalonServicesDefaults(userId: number): Promise<void> {
    await this.ensureAppointmentServicesDefaults(userId);
  }

  async setBusinessDetails(
    userId: number,
    details: { business_name?: string | null },
  ): Promise<{ business_name: string | null }> {
    if (details.business_name !== undefined) {
      const trimmed = details.business_name?.trim() ?? '';
      await this.set(userId, 'business_name', trimmed || null);
    }
    const business_name = (await this.get(userId, 'business_name')) ?? null;
    return { business_name };
  }
}
