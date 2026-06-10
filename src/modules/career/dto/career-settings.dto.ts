import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
  jsearch_default_country?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  jsearch_max_pages?: number;

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
  @IsInt()
  @Min(1)
  @Max(90)
  seeker_trial_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  seeker_price_monthly_inr?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  seeker_price_yearly_inr?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  razorpay_plan_seeker_monthly?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  razorpay_plan_seeker_yearly?: string;
}
