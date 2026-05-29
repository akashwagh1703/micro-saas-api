import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
