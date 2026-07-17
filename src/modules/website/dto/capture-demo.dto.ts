import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

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
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Matches(/^(\+91|91|0)?[6-9]\d{9}$/, {
    message: 'Please provide a valid 10-digit Indian mobile number',
  })
  phone: string;

  @IsNotEmpty({ message: 'Business type is required' })
  @IsString()
  @MinLength(2, { message: 'Business type must be specified' })
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
