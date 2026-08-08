import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { UpdateUserAccessDto } from './dto/admin.dto';
import { ManualPaymentService } from '../billing/manual-payment.service';
import { PlatformUpiConfigService } from '../billing/platform-upi-config.service';
import { PlatformAuditService } from '../billing/platform-audit.service';
import { BillingService } from '../billing/billing.service';
import { RejectPaymentSubmissionDto, UpdateUserSubscriptionDto } from '../billing/dto/billing.dto';

@Controller('admin')
@UseGuards(TokenAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly manualPayment: ManualPaymentService,
    private readonly upiConfig: PlatformUpiConfigService,
    private readonly billing: BillingService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.getOverview();
  }

  @Get('analytics')
  analytics(@Query('days') days = '30') {
    return this.admin.getAnalytics(parseInt(days, 10) || 30);
  }

  @Get('transactions')
  listTransactions(
    @Query('page') page = '1',
    @Query('search') search = '',
    @Query('status') status = '',
  ) {
    return this.admin.listTransactions(parseInt(page, 10) || 1, search ?? '', status ?? '');
  }

  @Get('users')
  listUsers(
    @Query('page') page = '1',
    @Query('search') search = '',
    @Query('status') status = '',
    @Query('plan') plan = '',
  ) {
    return this.admin.listUsers(
      parseInt(page, 10) || 1,
      search ?? '',
      status ?? '',
      plan ?? '',
    );
  }

  @Get('users/:id')
  userDetail(@Param('id', ParseIntPipe) id: number) {
    return this.admin.getUserDetail(id);
  }

  @Patch('users/:id/access')
  updateAccess(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserAccessDto) {
    return this.admin.updateUserAccess(id, dto);
  }

  @Patch('users/:id/subscription')
  updateSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserSubscriptionDto) {
    return this.manualPayment.updateUserSubscription(id, dto);
  }

  @Get('payment-config')
  paymentConfig() {
    return this.upiConfig.getPublicConfig(
      this.billing.monthlyPriceInr(),
      this.billing.yearlyPriceInr(),
    );
  }

  @Post('payment-config/upi-qr')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadUpiQr(@UploadedFile() file?: { buffer: Buffer; mimetype: string }) {
    if (!file?.buffer?.length) {
      return { message: 'No file uploaded', upi_qr_url: null };
    }
    const upi_qr_url = await this.upiConfig.saveQrImage(file.buffer, file.mimetype);
    return { message: 'UPI QR saved', upi_qr_url };
  }

  @Get('payment-submissions')
  listPaymentSubmissions(
    @Query('status') status = 'pending',
    @Query('product') product = '',
    @Query('page') page = '1',
  ) {
    return this.manualPayment.listSubmissions({
      status: status || undefined,
      product: product || undefined,
      page: parseInt(page, 10) || 1,
    });
  }

  @Get('payment-submissions/:id')
  getPaymentSubmission(@Param('id', ParseIntPipe) id: number) {
    return this.manualPayment.getSubmission(id);
  }

  @Get('payment-submissions/:id/screenshot')
  async paymentScreenshot(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.manualPayment.readSubmissionScreenshot(id);
    res.setHeader('Content-Type', file.mimeType);
    res.send(file.buffer);
  }

  @Post('payment-submissions/:id/approve')
  approvePayment(
    @CurrentUser('id') adminId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.manualPayment.approveSubmission(adminId, id);
  }

  @Post('payment-submissions/:id/reject')
  rejectPayment(
    @CurrentUser('id') adminId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPaymentSubmissionDto,
  ) {
    return this.manualPayment.rejectSubmission(adminId, id, dto.reason);
  }

  @Get('platform-audit-log')
  platformAuditLog(
    @Query('page') page = '1',
    @Query('action') action = 'payment',
  ) {
    return this.platformAudit.listForAdmin({
      page: parseInt(page, 10) || 1,
      actionPrefix: action || undefined,
    });
  }
}
