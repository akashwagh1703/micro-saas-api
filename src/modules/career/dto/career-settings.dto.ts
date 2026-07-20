import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DIGITS_1_3 = /^[1-3]$/;
const TRIAL_DAYS = /^([1-9]|[1-8][0-9]|90)$/;
const PRICE_INR = /^[1-9]\d{0,7}$/;
const RAZORPAY_KEY_ID = /^rzp_(live|test)_[A-Za-z0-9]+$/;
const RAZORPAY_PLAN_ID = /^plan_[A-Za-z0-9]+$/;
const COUNTRY_CODE = /^[a-z]{2}$/i;

export class UpdateCareerSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  adzuna_app_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  adzuna_app_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  jsearch_rapidapi_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(COUNTRY_CODE, { message: 'Country code must be 2 letters (e.g. in)' })
  jsearch_default_country?: string;

  @IsOptional()
  @IsString()
  @Matches(DIGITS_1_3, { message: 'Max pages must be 1, 2, or 3' })
  jsearch_max_pages?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  linkedin_jobs_api_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  linkedin_jobs_api_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  naukri_jobs_api_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  naukri_jobs_api_key?: string;

  @IsOptional()
  @IsBoolean()
  seeker_billing_enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(TRIAL_DAYS, { message: 'Trial days must be between 1 and 90' })
  seeker_trial_days?: string;

  @IsOptional()
  @IsString()
  @Matches(PRICE_INR, { message: 'Monthly price must be a positive whole number (INR)' })
  seeker_price_monthly_inr?: string;

  @IsOptional()
  @IsString()
  @Matches(PRICE_INR, { message: 'Yearly price must be a positive whole number (INR)' })
  seeker_price_yearly_inr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(RAZORPAY_KEY_ID, { message: 'Invalid Razorpay Key ID (e.g. rzp_test_...)' })
  razorpay_key_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  razorpay_key_secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  razorpay_webhook_secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(RAZORPAY_PLAN_ID, { message: 'Invalid Razorpay plan ID (e.g. plan_...)' })
  razorpay_plan_seeker_monthly?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(RAZORPAY_PLAN_ID, { message: 'Invalid Razorpay plan ID (e.g. plan_...)' })
  razorpay_plan_seeker_yearly?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  seeker_payment_mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  seeker_upi_vpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  seeker_upi_payee_name?: string;
}
