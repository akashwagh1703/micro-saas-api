import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, MaxLength, IsArray, ValidateNested, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum InteractiveMessageType {
  QUICK_REPLY = 'QUICK_REPLY',
  LIST_MESSAGE = 'LIST_MESSAGE',
  FLOW_BUTTON = 'FLOW_BUTTON',
}

export class CreateOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  optionText: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  nextNodeId?: string;

  @IsInt()
  @Min(0)
  displayOrder: number;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreateInteractiveTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEnum(InteractiveMessageType)
  messageType: InteractiveMessageType;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  headerText?: string;

  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  footerText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOptionDto)
  options: CreateOptionDto[];
}

export class UpdateInteractiveTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  headerText?: string;

  @IsString()
  @IsOptional()
  bodyText?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  footerText?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateOptionDto)
  options?: CreateOptionDto[];
}

export class SendInteractiveMessageDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsInt()
  @IsNotEmpty()
  templateId: number;

  @IsInt()
  @IsNotEmpty()
  workflowId: number;

  @IsString()
  @IsOptional()
  nodeId?: string;
}

export class InteractiveMessageResponseDto {
  success: boolean;
  templateId: number;
  name: string;
  messageType: string;
  options: Array<{
    id: number;
    optionText: string;
    description?: string;
    nextNodeId?: string;
  }>;
  message?: string;
}

export class InteractiveTemplateListDto {
  id: number;
  name: string;
  messageType: string;
  bodyText: string;
  isActive: boolean;
  optionCount: number;
  createdAt: Date;
  updatedAt: Date;
}
