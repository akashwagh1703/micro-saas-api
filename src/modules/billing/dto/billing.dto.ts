import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SubscribeDto {
  @IsIn(['monthly', 'yearly'])
  plan!: 'monthly' | 'yearly';
}

export class VerifySubscriptionDto {
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
