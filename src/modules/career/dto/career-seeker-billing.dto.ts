import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SeekerSubscribeDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['monthly', 'yearly'])
  plan!: 'monthly' | 'yearly';
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
