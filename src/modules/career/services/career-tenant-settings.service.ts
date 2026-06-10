import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { UpdateCareerSettingsDto } from '../dto/career-settings.dto';

/** Per-operator (B2B tenant) CareerAI settings — stored in user_settings like WhatsApp / AI keys. */
export const CAREER_TENANT_KEYS = {
  ADZUNA_APP_ID: 'career_adzuna_app_id',
  ADZUNA_APP_KEY: 'career_adzuna_app_key',
  JSEARCH_RAPIDAPI_KEY: 'career_jsearch_rapidapi_key',
  JSEARCH_DEFAULT_COUNTRY: 'career_jsearch_default_country',
  JSEARCH_MAX_PAGES: 'career_jsearch_max_pages',
  LINKEDIN_JOBS_API_URL: 'career_linkedin_jobs_api_url',
  LINKEDIN_JOBS_API_KEY: 'career_linkedin_jobs_api_key',
  NAUKRI_JOBS_API_URL: 'career_naukri_jobs_api_url',
  NAUKRI_JOBS_API_KEY: 'career_naukri_jobs_api_key',
  SEEKER_BILLING_ENABLED: 'career_seeker_billing_enabled',
  SEEKER_TRIAL_DAYS: 'career_seeker_trial_days',
  SEEKER_PRICE_MONTHLY_INR: 'career_seeker_price_monthly_inr',
  SEEKER_PRICE_YEARLY_INR: 'career_seeker_price_yearly_inr',
  RAZORPAY_PLAN_SEEKER_MONTHLY: 'career_razorpay_plan_seeker_monthly',
  RAZORPAY_PLAN_SEEKER_YEARLY: 'career_razorpay_plan_seeker_yearly',
} as const;

export interface CareerJobSourcesConfig {
  adzunaAppId: string;
  adzunaAppKey: string;
  jsearchApiKey: string;
  jsearchDefaultCountry: string;
  jsearchMaxPages: number;
  linkedinApiUrl: string;
  linkedinApiKey: string;
  naukriApiUrl: string;
  naukriApiKey: string;
}

export interface CareerSeekerBillingConfig {
  enabled: boolean;
  trialDays: number;
  priceMonthlyInr: number;
  priceYearlyInr: number;
  razorpayPlanMonthly: string;
  razorpayPlanYearly: string;
}

export interface CareerOperatorSettingsResponse {
  job_sources: {
    adzuna_app_id: string;
    has_adzuna_app_key: boolean;
    has_jsearch_rapidapi_key: boolean;
    jsearch_default_country: string;
    jsearch_max_pages: number;
    linkedin_jobs_api_url: string;
    has_linkedin_jobs_api_key: boolean;
    naukri_jobs_api_url: string;
    has_naukri_jobs_api_key: boolean;
  };
  seeker_billing: {
    enabled: boolean;
    trial_days: number;
    price_monthly_inr: number;
    price_yearly_inr: number;
    razorpay_plan_seeker_monthly: string;
    razorpay_plan_seeker_yearly: string;
    razorpay_configured: boolean;
  };
}

const SETTINGS_FIELD_MAP = {
  adzuna_app_id: CAREER_TENANT_KEYS.ADZUNA_APP_ID,
  adzuna_app_key: CAREER_TENANT_KEYS.ADZUNA_APP_KEY,
  jsearch_rapidapi_key: CAREER_TENANT_KEYS.JSEARCH_RAPIDAPI_KEY,
  jsearch_default_country: CAREER_TENANT_KEYS.JSEARCH_DEFAULT_COUNTRY,
  jsearch_max_pages: CAREER_TENANT_KEYS.JSEARCH_MAX_PAGES,
  linkedin_jobs_api_url: CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_URL,
  linkedin_jobs_api_key: CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_KEY,
  naukri_jobs_api_url: CAREER_TENANT_KEYS.NAUKRI_JOBS_API_URL,
  naukri_jobs_api_key: CAREER_TENANT_KEYS.NAUKRI_JOBS_API_KEY,
  seeker_billing_enabled: CAREER_TENANT_KEYS.SEEKER_BILLING_ENABLED,
  seeker_trial_days: CAREER_TENANT_KEYS.SEEKER_TRIAL_DAYS,
  seeker_price_monthly_inr: CAREER_TENANT_KEYS.SEEKER_PRICE_MONTHLY_INR,
  seeker_price_yearly_inr: CAREER_TENANT_KEYS.SEEKER_PRICE_YEARLY_INR,
  razorpay_plan_seeker_monthly: CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_MONTHLY,
  razorpay_plan_seeker_yearly: CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_YEARLY,
} as const;

type SettingsField = keyof typeof SETTINGS_FIELD_MAP;

const ALL_KEYS = Object.values(CAREER_TENANT_KEYS);

@Injectable()
export class CareerTenantSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async getJobSourcesConfig(userId: number): Promise<CareerJobSourcesConfig> {
    const raw = await this.settings.getMany(userId, [
      CAREER_TENANT_KEYS.ADZUNA_APP_ID,
      CAREER_TENANT_KEYS.ADZUNA_APP_KEY,
      CAREER_TENANT_KEYS.JSEARCH_RAPIDAPI_KEY,
      CAREER_TENANT_KEYS.JSEARCH_DEFAULT_COUNTRY,
      CAREER_TENANT_KEYS.JSEARCH_MAX_PAGES,
      CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_URL,
      CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_KEY,
      CAREER_TENANT_KEYS.NAUKRI_JOBS_API_URL,
      CAREER_TENANT_KEYS.NAUKRI_JOBS_API_KEY,
    ]);

    const maxPagesRaw = parseInt(raw[CAREER_TENANT_KEYS.JSEARCH_MAX_PAGES] ?? '1', 10);

    return {
      adzunaAppId: (raw[CAREER_TENANT_KEYS.ADZUNA_APP_ID] ?? '').trim(),
      adzunaAppKey: (raw[CAREER_TENANT_KEYS.ADZUNA_APP_KEY] ?? '').trim(),
      jsearchApiKey: (raw[CAREER_TENANT_KEYS.JSEARCH_RAPIDAPI_KEY] ?? '').trim(),
      jsearchDefaultCountry: (raw[CAREER_TENANT_KEYS.JSEARCH_DEFAULT_COUNTRY] ?? 'in')
        .trim()
        .toLowerCase()
        .slice(0, 2) || 'in',
      jsearchMaxPages: Number.isNaN(maxPagesRaw) ? 1 : Math.min(Math.max(maxPagesRaw, 1), 3),
      linkedinApiUrl: (raw[CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_URL] ?? '').trim(),
      linkedinApiKey: (raw[CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_KEY] ?? '').trim(),
      naukriApiUrl: (raw[CAREER_TENANT_KEYS.NAUKRI_JOBS_API_URL] ?? '').trim(),
      naukriApiKey: (raw[CAREER_TENANT_KEYS.NAUKRI_JOBS_API_KEY] ?? '').trim(),
    };
  }

  async getSeekerBillingConfig(userId: number): Promise<CareerSeekerBillingConfig> {
    const raw = await this.settings.getMany(userId, [
      CAREER_TENANT_KEYS.SEEKER_BILLING_ENABLED,
      CAREER_TENANT_KEYS.SEEKER_TRIAL_DAYS,
      CAREER_TENANT_KEYS.SEEKER_PRICE_MONTHLY_INR,
      CAREER_TENANT_KEYS.SEEKER_PRICE_YEARLY_INR,
      CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_MONTHLY,
      CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_YEARLY,
    ]);

    const trialDays = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_TRIAL_DAYS] ?? '14', 10);
    const monthly = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_PRICE_MONTHLY_INR] ?? '199', 10);
    const yearly = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_PRICE_YEARLY_INR] ?? '1999', 10);

    return {
      enabled: raw[CAREER_TENANT_KEYS.SEEKER_BILLING_ENABLED] === 'true',
      trialDays: Number.isNaN(trialDays) ? 14 : Math.min(Math.max(trialDays, 1), 90),
      priceMonthlyInr: Number.isNaN(monthly) ? 199 : Math.max(monthly, 1),
      priceYearlyInr: Number.isNaN(yearly) ? 1999 : Math.max(yearly, 1),
      razorpayPlanMonthly: (raw[CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_MONTHLY] ?? '').trim(),
      razorpayPlanYearly: (raw[CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_YEARLY] ?? '').trim(),
    };
  }

  async getOperatorSettingsResponse(userId: number): Promise<CareerOperatorSettingsResponse> {
    const raw = await this.settings.getMany(userId, ALL_KEYS);
    const billing = await this.getSeekerBillingConfig(userId);
    const maxPagesRaw = parseInt(raw[CAREER_TENANT_KEYS.JSEARCH_MAX_PAGES] ?? '1', 10);

    return {
      job_sources: {
        adzuna_app_id: raw[CAREER_TENANT_KEYS.ADZUNA_APP_ID] ?? '',
        has_adzuna_app_key: !!raw[CAREER_TENANT_KEYS.ADZUNA_APP_KEY],
        has_jsearch_rapidapi_key: !!raw[CAREER_TENANT_KEYS.JSEARCH_RAPIDAPI_KEY],
        jsearch_default_country: raw[CAREER_TENANT_KEYS.JSEARCH_DEFAULT_COUNTRY] ?? 'in',
        jsearch_max_pages: Number.isNaN(maxPagesRaw) ? 1 : maxPagesRaw,
        linkedin_jobs_api_url: raw[CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_URL] ?? '',
        has_linkedin_jobs_api_key: !!raw[CAREER_TENANT_KEYS.LINKEDIN_JOBS_API_KEY],
        naukri_jobs_api_url: raw[CAREER_TENANT_KEYS.NAUKRI_JOBS_API_URL] ?? '',
        has_naukri_jobs_api_key: !!raw[CAREER_TENANT_KEYS.NAUKRI_JOBS_API_KEY],
      },
      seeker_billing: {
        enabled: billing.enabled,
        trial_days: billing.trialDays,
        price_monthly_inr: billing.priceMonthlyInr,
        price_yearly_inr: billing.priceYearlyInr,
        razorpay_plan_seeker_monthly: billing.razorpayPlanMonthly,
        razorpay_plan_seeker_yearly: billing.razorpayPlanYearly,
        razorpay_configured: !!(billing.razorpayPlanMonthly && billing.razorpayPlanYearly),
      },
    };
  }

  async saveOperatorSettings(userId: number, patch: UpdateCareerSettingsDto): Promise<void> {
    for (const field of Object.keys(SETTINGS_FIELD_MAP) as SettingsField[]) {
      if (!(field in patch) || patch[field] === undefined) {
        continue;
      }
      const value = patch[field];
      const key = SETTINGS_FIELD_MAP[field];
      if (value === null) {
        continue;
      }
      if (field === 'seeker_billing_enabled') {
        await this.settings.set(userId, key, value === true ? 'true' : 'false');
        continue;
      }
      if (value === '') {
        continue;
      }
      await this.settings.set(userId, key, String(value));
    }
  }
}
