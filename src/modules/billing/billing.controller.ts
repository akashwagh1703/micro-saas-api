import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { BillingService } from './billing.service';
import { ManualPaymentService } from './manual-payment.service';
import { SubmitManualPaymentDto, SubscribeDto, VerifySubscriptionDto } from './dto/billing.dto';

@Controller('billing')
@UseGuards(TokenAuthGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly manualPayment: ManualPaymentService,
  ) {}

  @Get('status')
  async status(@CurrentUser('id') userId: number) {
    return this.billing.getStatus(userId);
  }

  @Get('payment-config')
  paymentConfig() {
    return this.manualPayment.getPaymentConfig();
  }

  @Get('manual-payment/latest')
  async latestManualPayment(
    @CurrentUser('id') userId: number,
    @Query('product') product?: string,
  ) {
    const resolved = product === 'website' ? 'website' : 'platform';
    const submission = await this.manualPayment.getLatestSubmission(userId, resolved);
    return { submission };
  }

  @Post('manual-payment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async submitManualPayment(
    @CurrentUser('id') userId: number,
    @Body() dto: SubmitManualPaymentDto,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const product = dto.product === 'website' ? 'website' : 'platform';
    return this.manualPayment.submitManualPayment(
      userId,
      dto.plan,
      dto.upi_transaction_id,
      {
        buffer: file?.buffer ?? Buffer.alloc(0),
        mimetype: file?.mimetype ?? 'image/jpeg',
      },
      product,
    );
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
