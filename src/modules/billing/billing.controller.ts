import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { BillingService } from './billing.service';
import { SubscribeDto, VerifySubscriptionDto } from './dto/billing.dto';

@Controller('billing')
@UseGuards(TokenAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  async status(@CurrentUser('id') userId: number) {
    return this.billing.getStatus(userId);
  }

  @Post('subscribe')
  async subscribe(@CurrentUser('id') userId: number, @Body() dto: SubscribeDto) {
    return this.billing.createSubscription(userId, dto.plan);
  }

  @Post('verify')
  async verify(@CurrentUser('id') userId: number, @Body() dto: VerifySubscriptionDto) {
    const status = await this.billing.activateFromCheckout(
      userId,
      dto.razorpay_payment_id,
      dto.razorpay_subscription_id,
      dto.razorpay_signature,
    );
    return { status };
  }

  @Post('cancel')
  async cancel(@CurrentUser('id') userId: number) {
    const status = await this.billing.cancelSubscription(userId);
    return { status };
  }

  @Get('transactions')
  async transactions(@CurrentUser('id') userId: number) {
    return this.billing.getTransactions(userId);
  }
}
