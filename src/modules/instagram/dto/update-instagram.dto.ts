import { IsOptional, IsString } from 'class-validator';

export class UpdateInstagramDto {
  @IsOptional()
  @IsString()
  access_token?: string;

  @IsOptional()
  @IsString()
  page_id?: string;

  @IsOptional()
  @IsString()
  instagram_user_id?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsString()
  verify_token?: string;

  @IsOptional()
  @IsString()
  app_secret?: string;
}
