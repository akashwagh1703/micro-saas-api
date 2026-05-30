import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { BUSINESS_CATEGORIES, USE_CASES } from '../../settings/dto/settings.dto';

export class CreateWorkflowDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  trigger_type?: string;

  @IsOptional()
  @IsObject()
  definition?: Record<string, any>;
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  trigger_type?: string;

  @IsOptional()
  @IsObject()
  definition?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ValidateDefinitionDto {
  @IsObject()
  definition: Record<string, any>;
}

export class GenerateWorkflowDto {
  @IsIn(BUSINESS_CATEGORIES as unknown as string[])
  business_category: string;

  @IsIn(USE_CASES as unknown as string[])
  use_case: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  business_description?: string;
}

export class GenerateWorkflowQueryDto extends GenerateWorkflowDto {}
