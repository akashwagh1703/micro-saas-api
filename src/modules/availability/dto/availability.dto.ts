import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const RESOURCE_TYPES = [
  'barber',
  'doctor',
  'agent',
  'room',
  'counselor',
  'consultant',
] as const;

export const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const;

export class CreateResourceDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @IsIn([...RESOURCE_TYPES])
  type?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn([...RESOURCE_TYPES])
  type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ScheduleSlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  @IsString()
  @MaxLength(5)
  start_time!: string;

  @IsString()
  @MaxLength(5)
  end_time!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  slot_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SetResourceScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleSlotDto)
  weekly_slots!: ScheduleSlotDto[];
}

export class CreateBookingDto {
  @IsInt()
  resource_id!: number;

  @IsISO8601()
  starts_at!: string;

  @IsISO8601()
  ends_at!: string;

  @IsOptional()
  @IsInt()
  contact_id?: number;

  @IsOptional()
  @IsInt()
  conversation_id?: number;

  @IsOptional()
  @IsInt()
  workflow_execution_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  service_label?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @IsIn([...BOOKING_STATUSES])
  status?: string;
}

export class UpdateBookingDto {
  @IsString()
  @IsIn([...BOOKING_STATUSES])
  status!: string;
}
