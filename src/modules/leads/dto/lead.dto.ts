import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'lost', 'won'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export class CreateLeadWhatsAppDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  source_message?: string;

  @IsOptional()
  @IsObject()
  collected?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  contact_id?: number;

  @IsOptional()
  @IsInt()
  conversation_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
