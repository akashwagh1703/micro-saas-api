import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SeekerSubscribeDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['monthly', 'yearly'])
  plan!: 'monthly' | 'yearly';
}

export class SeekerCancelSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class SeekerVerifySubscriptionDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  razorpay_payment_id!: string;

  @IsString()
  @IsNotEmpty()
  razorpay_subscription_id!: string;

  @IsString()
  @IsNotEmpty()
  razorpay_signature!: string;
}

export class SubmitSeekerManualPaymentDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['monthly', 'yearly'])
  plan!: 'monthly' | 'yearly';

  @IsString()
  @IsNotEmpty()
  upi_transaction_id!: string;
}
