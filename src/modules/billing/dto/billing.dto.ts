import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SubscribeDto {
  @IsIn(['monthly', 'yearly'])
  plan: 'monthly' | 'yearly';
}

export class VerifySubscriptionDto {
  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_subscription_id: string;

  @IsString()
  razorpay_signature: string;
}

export class SubmitManualPaymentDto {
  @IsIn(['monthly', 'yearly'])
  plan: 'monthly' | 'yearly';

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  upi_transaction_id: string;

  /** platform = bots; website = brochure publish add-on. Defaults to platform. */
  @IsOptional()
  @IsIn(['platform', 'website'])
  product?: 'platform' | 'website';
}

export class RejectPaymentSubmissionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class UpdateUserSubscriptionDto {
  @IsOptional()
  @IsIn(['trial', 'active', 'cancelled', 'expired', 'pending_verification'])
  subscription_status?: string;

  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  plan?: 'monthly' | 'yearly';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  extend_period_days?: number;

  @IsOptional()
  @IsString()
  set_period_end?: string;

  /** Keep access until current_period_end, then expire. */
  @IsOptional()
  @IsBoolean()
  cancel_at_period_end?: boolean;

  /** Grant active access for N days from today (reactivate / comp). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  grant_period_days?: number;
}
