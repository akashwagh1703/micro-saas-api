import { IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ArrayMinSize } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

export class ChangePasswordDto {
  @IsString()
  current_password: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  password_confirmation?: string;
}

export const BUSINESS_CATEGORIES = [
  'farmer',
  'real_estate',
  'coaching',
  'clinic',
  'local_shop',
  'travel',
  'insurance',
  'ca_accountant',
  'support',
  'career_ai',
  'other',
] as const;

export const USE_CASES = [
  'customer_support',
  'lead_generation',
  'appointment_booking',
  'sales_assistant',
  'faq_bot',
  'ai_chat',
] as const;

export class UpdateBusinessProfileDto {
  @IsIn(BUSINESS_CATEGORIES as unknown as string[])
  business_category: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(USE_CASES as unknown as string[], { each: true })
  use_cases: string[];

  /** Required when business_category is "other" — describes the business for AI workflow generation. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  business_description?: string;
}

export class UpdateIntegrationsDto {
  @IsOptional()
  @IsString()
  openrouter_api_key?: string;

  @IsOptional()
  @IsString()
  openai_api_key?: string;

  @IsOptional()
  @IsIn(['openrouter', 'openai'])
  ai_provider?: string;

  @IsOptional()
  @IsString()
  ai_model?: string;
}
