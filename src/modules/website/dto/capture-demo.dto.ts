import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { parseStrictIndianMobile } from '../../../common/phone.util';

@ValidatorConstraint({ name: 'strictIndianMobile', async: false })
class StrictIndianMobileConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !value.trim()) {
      return false;
    }
    return parseStrictIndianMobile(value) !== null;
  }

  defaultMessage(): string {
    return 'Phone must be exactly 10 digits (Indian mobile, starting with 6–9).';
  }
}

/**
 * DTO for capturing demo request from marketing website
 * Validates data before storing in database
 */
export class CaptureDemoDto {
  @IsNotEmpty({ message: 'Name is required' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters' })
  name: string;

  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254, { message: 'Email is too long' })
  email: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @MaxLength(16)
  @Validate(StrictIndianMobileConstraint)
  phone: string;

  @IsNotEmpty({ message: 'Business type is required' })
  @IsString()
  @MinLength(2, { message: 'Business type must be specified' })
  @MaxLength(50)
  businessType: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  monthlyMessages?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Challenge description cannot exceed 500 characters' })
  challenge?: string;

  @IsOptional()
  @IsString()
  source?: string = 'website';
}

/**
 * Response DTO for demo capture
 */
export class CaptureDemoResponseDto {
  success: boolean;
  leadId: number;
  message: string;
  demoLink?: string;
}
