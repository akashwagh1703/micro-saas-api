import { IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * DTO for contact form submissions
 * Alternative to demo request
 */
export class ContactUsDto {
  @IsNotEmpty({ message: 'Name is required' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters' })
  name: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsOptional()
  @IsPhoneNumber('IN', { message: 'Please provide a valid Indian phone number' })
  phone?: string;

  @IsNotEmpty({ message: 'Subject is required' })
  @IsString()
  @MinLength(5, { message: 'Subject must be at least 5 characters' })
  @MaxLength(100)
  subject: string;

  @IsNotEmpty({ message: 'Message is required' })
  @IsString()
  @MinLength(10, { message: 'Message must be at least 10 characters' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters' })
  message: string;

  @IsOptional()
  @IsString()
  source?: string = 'website';
}

/**
 * Response DTO for contact form
 */
export class ContactUsResponseDto {
  success: boolean;
  message: string;
  referenceId?: string;
}
