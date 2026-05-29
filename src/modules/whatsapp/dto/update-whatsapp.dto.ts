import { IsOptional, IsString } from 'class-validator';

export class UpdateWhatsAppDto {
  @IsOptional()
  @IsString()
  access_token?: string;

  @IsOptional()
  @IsString()
  phone_number_id?: string;

  @IsOptional()
  @IsString()
  business_account_id?: string;

  @IsOptional()
  @IsString()
  verify_token?: string;

  @IsOptional()
  @IsString()
  app_secret?: string;
}
