import { IsOptional, IsString, IsEnum } from 'class-validator';

/**
 * DTO for updating website lead
 */
export class UpdateWebsiteLeadDto {
  @IsOptional()
  @IsEnum(['new', 'contacted', 'demo_confirmed', 'converted', 'lost'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(['cold', 'warm', 'hot'])
  qualification?: string;

  @IsOptional()
  score?: number;
}
