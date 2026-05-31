import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'lost', 'won'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Matches the workflow save_lead node context + optional execution metadata.
 * Accepts both workflow template names (contact_name, __collected) and explicit API names.
 */
export class SaveLeadDto {
  /** Workflow context: {{contact_name}} */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contact_name?: string;

  /** Workflow context: {{contact_phone}} */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;

  /** Workflow context: incoming {{message}} */
  @IsOptional()
  @IsString()
  message?: string;

  /** Workflow context: answers from collect_input steps */
  @IsOptional()
  @IsObject()
  __collected?: Record<string, unknown>;

  /** Explicit API alias for name */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /** Explicit API alias for phone */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Workflow context: {{contact_username}} (Instagram) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contact_username?: string;

  /** Explicit API alias for first message */
  @IsOptional()
  @IsString()
  source_message?: string;

  /** Explicit API alias for collected answers */
  @IsOptional()
  @IsObject()
  collected?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsInt()
  contact_id?: number;

  @IsOptional()
  @IsInt()
  conversation_id?: number;

  @IsOptional()
  @IsInt()
  workflow_id?: number;

  @IsOptional()
  @IsInt()
  execution_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** @deprecated Use SaveLeadDto — kept as alias for POST /leads/whatsapp */
export class CreateLeadWhatsAppDto extends SaveLeadDto {}

/** Alias for POST /api/leads/instagram */
export class CreateLeadInstagramDto extends SaveLeadDto {}

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
