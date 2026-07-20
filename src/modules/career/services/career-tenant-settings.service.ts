import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
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
  RAZORPAY_KEY_ID: 'career_razorpay_key_id',
  RAZORPAY_KEY_SECRET: 'career_razorpay_key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'career_razorpay_webhook_secret',
  SEEKER_PAYMENT_MODE: 'career_seeker_payment_mode',
  SEEKER_UPI_VPA: 'career_seeker_upi_vpa',
  SEEKER_UPI_PAYEE_NAME: 'career_seeker_upi_payee_name',
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
  paymentMode: 'razorpay' | 'upi_manual' | 'both';
  upiVpa: string;
  upiPayeeName: string;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
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
    razorpay_key_id: string;
    has_razorpay_key_secret: boolean;
    has_razorpay_webhook_secret: boolean;
    razorpay_plan_seeker_monthly: string;
    razorpay_plan_seeker_yearly: string;
    razorpay_webhook_url: string;
    razorpay_configured: boolean;
    payment_mode: 'razorpay' | 'upi_manual' | 'both';
    upi_vpa: string;
    upi_payee_name: string;
    upi_qr_url: string | null;
    upi_configured: boolean;
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
  razorpay_key_id: CAREER_TENANT_KEYS.RAZORPAY_KEY_ID,
  razorpay_key_secret: CAREER_TENANT_KEYS.RAZORPAY_KEY_SECRET,
  razorpay_webhook_secret: CAREER_TENANT_KEYS.RAZORPAY_WEBHOOK_SECRET,
  seeker_payment_mode: CAREER_TENANT_KEYS.SEEKER_PAYMENT_MODE,
  seeker_upi_vpa: CAREER_TENANT_KEYS.SEEKER_UPI_VPA,
  seeker_upi_payee_name: CAREER_TENANT_KEYS.SEEKER_UPI_PAYEE_NAME,
} as const;

type SettingsField = keyof typeof SETTINGS_FIELD_MAP;

const ALL_KEYS = Object.values(CAREER_TENANT_KEYS);

@Injectable()
export class CareerTenantSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  getRazorpayWebhookUrl(): string {
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${appUrl}/api/webhook/razorpay`;
  }

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
      CAREER_TENANT_KEYS.RAZORPAY_KEY_ID,
      CAREER_TENANT_KEYS.RAZORPAY_KEY_SECRET,
      CAREER_TENANT_KEYS.RAZORPAY_WEBHOOK_SECRET,
      CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_MONTHLY,
      CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_YEARLY,
      CAREER_TENANT_KEYS.SEEKER_PAYMENT_MODE,
      CAREER_TENANT_KEYS.SEEKER_UPI_VPA,
      CAREER_TENANT_KEYS.SEEKER_UPI_PAYEE_NAME,
    ]);

    const trialDays = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_TRIAL_DAYS] ?? '14', 10);
    const monthly = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_PRICE_MONTHLY_INR] ?? '199', 10);
    const yearly = parseInt(raw[CAREER_TENANT_KEYS.SEEKER_PRICE_YEARLY_INR] ?? '1999', 10);
    const modeRaw = (raw[CAREER_TENANT_KEYS.SEEKER_PAYMENT_MODE] ?? 'razorpay').trim().toLowerCase();
    const paymentMode =
      modeRaw === 'upi_manual' || modeRaw === 'both' ? (modeRaw as CareerSeekerBillingConfig['paymentMode']) : 'razorpay';

    return {
      enabled: raw[CAREER_TENANT_KEYS.SEEKER_BILLING_ENABLED] === 'true',
      trialDays: Number.isNaN(trialDays) ? 14 : Math.min(Math.max(trialDays, 1), 90),
      priceMonthlyInr: Number.isNaN(monthly) ? 199 : Math.max(monthly, 1),
      priceYearlyInr: Number.isNaN(yearly) ? 1999 : Math.max(yearly, 1),
      paymentMode,
      upiVpa: (raw[CAREER_TENANT_KEYS.SEEKER_UPI_VPA] ?? '').trim(),
      upiPayeeName: (raw[CAREER_TENANT_KEYS.SEEKER_UPI_PAYEE_NAME] ?? '').trim(),
      razorpayKeyId: (raw[CAREER_TENANT_KEYS.RAZORPAY_KEY_ID] ?? '').trim(),
      razorpayKeySecret: (raw[CAREER_TENANT_KEYS.RAZORPAY_KEY_SECRET] ?? '').trim(),
      razorpayWebhookSecret: (raw[CAREER_TENANT_KEYS.RAZORPAY_WEBHOOK_SECRET] ?? '').trim(),
      razorpayPlanMonthly: (raw[CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_MONTHLY] ?? '').trim(),
      razorpayPlanYearly: (raw[CAREER_TENANT_KEYS.RAZORPAY_PLAN_SEEKER_YEARLY] ?? '').trim(),
    };
  }

  isSeekerRazorpayConfigured(cfg: CareerSeekerBillingConfig): boolean {
    return !!(
      cfg.razorpayKeyId &&
      cfg.razorpayKeySecret &&
      cfg.razorpayWebhookSecret &&
      cfg.razorpayPlanMonthly &&
      cfg.razorpayPlanYearly
    );
  }

  async getOperatorSettingsResponse(userId: number): Promise<CareerOperatorSettingsResponse> {
    const raw = await this.settings.getMany(userId, ALL_KEYS);
    const billing = await this.getSeekerBillingConfig(userId);
    const maxPagesRaw = parseInt(raw[CAREER_TENANT_KEYS.JSEARCH_MAX_PAGES] ?? '1', 10);
    const qrRoot =
      this.config.get<string>('CAREER_UPI_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'career-upi');
    const hasQr = fs.existsSync(path.join(qrRoot, String(userId), 'qr'));
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    const upiQrUrl = hasQr ? `${appUrl}/api/career/billing/upi-qr` : null;

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
        razorpay_key_id: billing.razorpayKeyId,
        has_razorpay_key_secret: !!billing.razorpayKeySecret,
        has_razorpay_webhook_secret: !!billing.razorpayWebhookSecret,
        razorpay_plan_seeker_monthly: billing.razorpayPlanMonthly,
        razorpay_plan_seeker_yearly: billing.razorpayPlanYearly,
        razorpay_webhook_url: this.getRazorpayWebhookUrl(),
        razorpay_configured: this.isSeekerRazorpayConfigured(billing),
        payment_mode: billing.paymentMode,
        upi_vpa: billing.upiVpa,
        upi_payee_name: billing.upiPayeeName,
        upi_qr_url: upiQrUrl,
        upi_configured: !!(billing.upiVpa && upiQrUrl),
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
      if (field === 'seeker_payment_mode') {
        const mode = String(value).trim().toLowerCase();
        if (mode === 'razorpay' || mode === 'upi_manual' || mode === 'both') {
          await this.settings.set(userId, key, mode);
        }
        continue;
      }
      if (value === '') {
        continue;
      }
      await this.settings.set(userId, key, String(value));
    }
  }
}
