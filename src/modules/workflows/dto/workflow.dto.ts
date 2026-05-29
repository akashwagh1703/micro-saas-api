import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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
