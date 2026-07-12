import { IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BUSINESS_CATEGORY_KEYS, USE_CASE_KEYS } from '../../../platform/business-verticals.registry';

export class SalonServiceOptionDto {
  @IsString()
  @MaxLength(20)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(72)
  description?: string;

  @IsString()
  @MaxLength(40)
  value: string;
}

export class UpdateSalonServicesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalonServiceOptionDto)
  services: SalonServiceOptionDto[];
}

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

export const BUSINESS_CATEGORIES = BUSINESS_CATEGORY_KEYS;
export const USE_CASES = USE_CASE_KEYS;

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
