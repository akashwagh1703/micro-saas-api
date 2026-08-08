import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingPlan, BillingProduct, BillingService } from './billing.service';
import { PaymentProofStorageService } from './payment-proof-storage.service';
import { PlatformUpiConfigService } from './platform-upi-config.service';
import { PlatformAuditService } from './platform-audit.service';
import { BillingNotificationService } from './billing-notification.service';
import { ManualPaymentExpiryService } from './manual-payment-expiry.service';

export type PaymentSubmissionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PaymentSubmissionView {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  product: string;
  plan: string;
  amount_inr: number;
  upi_transaction_id: string;
  status: PaymentSubmissionStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

@Injectable()
export class ManualPaymentService {
  private readonly logger = new Logger(ManualPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly proofStorage: PaymentProofStorageService,
    private readonly upiConfig: PlatformUpiConfigService,
    private readonly audit: PlatformAuditService,
    private readonly notifications: BillingNotificationService,
    private readonly expiry: ManualPaymentExpiryService,
  ) {}

  getPaymentConfig() {
    const platform = this.upiConfig.getPublicConfig(
      this.billing.monthlyPriceInr(),
      this.billing.yearlyPriceInr(),
    );
    return {
      ...platform,
      website: {
        billing_enabled: this.billing.isWebsiteBillingEnabled(),
        prices: {
          monthly_inr: this.billing.websiteMonthlyPriceInr(),
          yearly_inr: this.billing.websiteYearlyPriceInr(),
        },
      },
    };
  }

  async getLatestSubmission(
    userId: number,
    product: BillingProduct = 'platform',
  ): Promise<PaymentSubmissionView | null> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { userId, product },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toView(row) : null;
  }

  async submitManualPayment(
    userId: number,
    plan: BillingPlan,
    upiTransactionId: string,
    file: { buffer: Buffer; mimetype: string },
    product: BillingProduct = 'platform',
  ): Promise<{ submission: PaymentSubmissionView; status: Awaited<ReturnType<BillingService['getStatus']>> }> {
    if (!this.billing.isEnabled()) {
      throw new UnprocessableEntityException('Billing is not enabled.');
    }
    if (product === 'website' && !this.billing.isWebsiteBillingEnabled()) {
      throw new UnprocessableEntityException('Website add-on billing is not enabled.');
    }
    if (!this.upiConfig.isUpiManualEnabled()) {
      throw new UnprocessableEntityException('UPI manual payments are not enabled.');
    }
    this.upiConfig.assertUpiConfigured();

    const utr = upiTransactionId.trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{8,64}$/.test(utr)) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { upi_transaction_id: ['Enter a valid UPI transaction / UTR reference (8–64 characters).'] },
      });
    }
    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { file: ['Upload a payment screenshot.'] },
      });
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { file: ['Screenshot must be 5 MB or smaller.'] },
      });
    }

    const user = await this.billing.getUser(userId);
    const current = this.billing.resolveStatus(user);

    if (product === 'website') {
      const website = current.website;
      if (website.status === 'active') {
        throw new UnprocessableEntityException('You already have an active Website add-on.');
      }
      if (website.status === 'pending_verification') {
        throw new UnprocessableEntityException(
          'A Website add-on payment is already under review. Wait for verification or contact support.',
        );
      }
    } else {
      if (current.status === 'active') {
        throw new UnprocessableEntityException('You already have an active subscription.');
      }
      if (current.status === 'pending_verification') {
        throw new UnprocessableEntityException(
          'A payment is already under review. Wait for verification or contact support.',
        );
      }
    }

    const duplicate = await this.prisma.paymentSubmission.findFirst({
      where: {
        product,
        upiTransactionId: utr,
        status: { in: ['pending', 'approved'] },
      },
    });
    if (duplicate) {
      await this.audit.log({
        action: 'payment.duplicate_utr',
        targetUserId: userId,
        paymentSubmissionId: duplicate.id,
        details: {
          product,
          upi_transaction_id: utr,
          existing_status: duplicate.status,
          existing_user_id: duplicate.userId,
        },
      });
      await this.notifications.notifyAdminDuplicateUtr({
        utr,
        userId,
        userEmail: user.email,
      });
      throw new UnprocessableEntityException({
        message:
          'This UPI transaction ID was already submitted. Use a different reference or contact support.',
        code: 'duplicate_utr',
      });
    }

    const amountInr = this.billing.priceInrForProduct(product, plan);

    const submission = await this.prisma.paymentSubmission.create({
      data: {
        userId,
        product,
        plan,
        amountInr,
        upiTransactionId: utr,
        screenshotToken: 'pending',
        status: 'pending',
      },
    });

    const { token } = await this.proofStorage.saveProof(
      userId,
      submission.id,
      file.buffer,
      file.mimetype,
    );

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: { screenshotToken: token },
    });

    if (product === 'website') {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          websiteSubscriptionStatus: 'pending_verification',
          websiteSubscriptionPlan: plan,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionStatus: 'pending_verification',
          subscriptionPlan: plan,
        },
      });
    }

    this.logger.log(
      `Manual payment submitted userId=${userId} product=${product} plan=${plan} utr=${utr}`,
    );

    await this.audit.log({
      action: 'payment.submitted',
      targetUserId: userId,
      paymentSubmissionId: submission.id,
      details: { product, plan, amount_inr: amountInr, upi_transaction_id: utr },
    });

    const updated = await this.prisma.paymentSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });

    return {
      submission: this.toView(updated),
      status: await this.billing.getStatus(userId),
    };
  }

  async listSubmissions(params: {
    status?: string;
    product?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: PaymentSubmissionView[]; total: number; page: number; per_page: number }> {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
    const where: Prisma.PaymentSubmissionWhereInput = {};
    if (params.product?.trim()) {
      where.product = params.product.trim();
    } else {
      where.product = { in: ['platform', 'website'] };
    }
    if (params.status?.trim()) {
      where.status = params.status.trim();
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentSubmission.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.paymentSubmission.count({ where }),
    ]);

    return {
      data: rows.map((r) =>
        this.toView(r, { name: r.user.name, email: r.user.email }),
      ),
      total,
      page,
      per_page: perPage,
    };
  }

  async getSubmission(id: number): Promise<PaymentSubmissionView> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { id, product: { in: ['platform', 'website'] } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!row) throw new NotFoundException('Payment submission not found');
    return this.toView(row, { name: row.user.name, email: row.user.email });
  }

  async readSubmissionScreenshot(id: number): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { id, product: { in: ['platform', 'website'] } },
    });
    if (!row) throw new NotFoundException('Payment submission not found');
    const file = await this.proofStorage.readProof(row.userId, row.id, row.screenshotToken);
    if (!file) throw new NotFoundException('Screenshot not found');
    return file;
  }

  async approveSubmission(adminUserId: number, submissionId: number) {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: { in: ['platform', 'website'] } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!submission) throw new NotFoundException('Payment submission not found');
    if (submission.status !== 'pending') {
      throw new UnprocessableEntityException(`Submission is already ${submission.status}.`);
    }

    const product = submission.product as BillingProduct;
    const utrConflict = await this.prisma.paymentSubmission.findFirst({
      where: {
        product,
        upiTransactionId: submission.upiTransactionId,
        status: 'approved',
        id: { not: submission.id },
      },
    });
    if (utrConflict) {
      await this.audit.log({
        action: 'payment.approve_blocked_duplicate_utr',
        actorAdminId: adminUserId,
        targetUserId: submission.userId,
        paymentSubmissionId: submission.id,
        details: {
          product,
          upi_transaction_id: submission.upiTransactionId,
          conflict_submission_id: utrConflict.id,
        },
      });
      throw new UnprocessableEntityException(
        'This UPI transaction ID was already approved on another submission.',
      );
    }

    const plan = submission.plan as BillingPlan;
    const periodEnd = this.billing.estimatePeriodEndForPlan(plan);

    if (product === 'website') {
      await this.prisma.user.update({
        where: { id: submission.userId },
        data: {
          websiteSubscriptionStatus: 'active',
          websiteSubscriptionPlan: plan,
          websiteCurrentPeriodEnd: periodEnd,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: submission.userId },
        data: {
          subscriptionStatus: 'active',
          subscriptionPlan: plan,
          currentPeriodEnd: periodEnd,
          subscriptionCancelAtPeriodEnd: false,
        },
      });
    }

    const txn = await this.billing.recordManualTransaction({
      userId: submission.userId,
      product,
      eventType: 'manual.approved',
      plan,
      amountInr: submission.amountInr,
      upiTransactionId: submission.upiTransactionId,
      paymentSubmissionId: submission.id,
      reviewedByAdminId: adminUserId,
    });

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'approved',
        reviewedByAdminId: adminUserId,
        reviewedAt: new Date(),
        metadata: {
          billing_transaction_id: txn.id,
        },
      },
    });

    this.logger.log(
      `Payment approved submission=${submissionId} product=${product} userId=${submission.userId}`,
    );

    await this.audit.log({
      action: 'payment.approved',
      actorAdminId: adminUserId,
      targetUserId: submission.userId,
      paymentSubmissionId: submission.id,
      details: {
        product,
        plan,
        amount_inr: submission.amountInr,
        upi_transaction_id: submission.upiTransactionId,
        billing_transaction_id: txn.id,
      },
    });

    await this.notifications.notifyPaymentApproved({
      userId: submission.userId,
      to: submission.user.email,
      name: submission.user.name,
      plan,
      amountInr: submission.amountInr,
      periodEnd,
    });

    return {
      submission: await this.getSubmission(submission.id),
      user_status: await this.billing.getStatus(submission.userId),
    };
  }

  async rejectSubmission(adminUserId: number, submissionId: number, reason: string) {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: { in: ['platform', 'website'] } },
      include: { user: { select: { id: true, name: true, email: true, trialEndsAt: true } } },
    });
    if (!submission) throw new NotFoundException('Payment submission not found');
    if (submission.status !== 'pending') {
      throw new UnprocessableEntityException(`Submission is already ${submission.status}.`);
    }

    const product = submission.product as BillingProduct;
    const trimmedReason = reason.trim().slice(0, 500) || 'Payment could not be verified.';
    const trialStillValid = submission.user.trialEndsAt > new Date();

    if (product === 'website') {
      await this.prisma.user.update({
        where: { id: submission.userId },
        data: {
          websiteSubscriptionStatus: trialStillValid ? 'none' : 'expired',
          websiteSubscriptionPlan: null,
          websiteCurrentPeriodEnd: null,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: submission.userId },
        data: {
          subscriptionStatus: trialStillValid ? 'trial' : 'expired',
          subscriptionPlan: trialStillValid ? null : submission.plan,
          currentPeriodEnd: null,
        },
      });
    }

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'rejected',
        rejectionReason: trimmedReason,
        reviewedByAdminId: adminUserId,
        reviewedAt: new Date(),
      },
    });

    await this.billing.recordManualTransaction({
      userId: submission.userId,
      product,
      eventType: 'manual.rejected',
      plan: submission.plan as BillingPlan,
      amountInr: submission.amountInr,
      upiTransactionId: submission.upiTransactionId,
      paymentSubmissionId: submission.id,
      reviewedByAdminId: adminUserId,
      status: 'rejected',
    });

    this.logger.log(
      `Payment rejected submission=${submissionId} product=${product} userId=${submission.userId}`,
    );

    await this.audit.log({
      action: 'payment.rejected',
      actorAdminId: adminUserId,
      targetUserId: submission.userId,
      paymentSubmissionId: submission.id,
      details: {
        product,
        plan: submission.plan,
        reason: trimmedReason,
        upi_transaction_id: submission.upiTransactionId,
      },
    });

    await this.notifications.notifyPaymentRejected({
      to: submission.user.email,
      name: submission.user.name,
      plan: submission.plan,
      reason: trimmedReason,
    });

    return {
      submission: await this.getSubmission(submission.id),
      user_status: await this.billing.getStatus(submission.userId),
    };
  }

  async updateUserSubscription(
    targetUserId: number,
    dto: {
      subscription_status?: string;
      plan?: BillingPlan | null;
      extend_period_days?: number;
      set_period_end?: string;
      cancel_at_period_end?: boolean;
      grant_period_days?: number;
    },
  ) {
    const user = await this.billing.getUser(targetUserId);
    const data: {
      subscriptionStatus?: string;
      subscriptionPlan?: string | null;
      currentPeriodEnd?: Date | null;
      trialEndsAt?: Date;
      subscriptionCancelAtPeriodEnd?: boolean;
    } = {};

    if (dto.grant_period_days) {
      const plan = (dto.plan ?? user.subscriptionPlan ?? 'monthly') as BillingPlan;
      const ends = new Date();
      ends.setDate(ends.getDate() + dto.grant_period_days);
      data.subscriptionStatus = 'active';
      data.subscriptionPlan = plan;
      data.currentPeriodEnd = ends;
      data.subscriptionCancelAtPeriodEnd = false;
    }

    if (dto.cancel_at_period_end === true) {
      data.subscriptionCancelAtPeriodEnd = true;
      if (user.currentPeriodEnd && user.currentPeriodEnd > new Date()) {
        data.subscriptionStatus = 'active';
      }
    } else if (dto.cancel_at_period_end === false) {
      data.subscriptionCancelAtPeriodEnd = false;
    }

    if (dto.subscription_status) {
      data.subscriptionStatus = dto.subscription_status;
      if (dto.subscription_status === 'cancelled' || dto.subscription_status === 'expired') {
        data.currentPeriodEnd = null;
        data.subscriptionCancelAtPeriodEnd = false;
      }
      if (
        dto.subscription_status === 'active' &&
        !dto.extend_period_days &&
        !dto.set_period_end &&
        !dto.grant_period_days
      ) {
        const plan = (dto.plan ?? user.subscriptionPlan ?? 'monthly') as BillingPlan;
        data.currentPeriodEnd = this.billing.estimatePeriodEndForPlan(plan);
        data.subscriptionPlan = plan;
        data.subscriptionCancelAtPeriodEnd = false;
      }
      if (dto.subscription_status === 'trial') {
        data.currentPeriodEnd = null;
        data.subscriptionCancelAtPeriodEnd = false;
      }
    }

    if (dto.plan !== undefined && !dto.grant_period_days) {
      data.subscriptionPlan = dto.plan;
    }

    if (dto.set_period_end) {
      data.currentPeriodEnd = new Date(dto.set_period_end);
      data.subscriptionStatus = 'active';
      data.subscriptionCancelAtPeriodEnd = false;
    } else if (dto.extend_period_days) {
      const base =
        user.currentPeriodEnd && user.currentPeriodEnd > new Date()
          ? user.currentPeriodEnd
          : new Date();
      const extended = new Date(base);
      extended.setDate(extended.getDate() + dto.extend_period_days);
      data.currentPeriodEnd = extended;
      data.subscriptionStatus = 'active';
      data.subscriptionCancelAtPeriodEnd = false;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: targetUserId }, data });
    }

    return this.billing.getStatus(targetUserId);
  }

  private toView(
    row: {
      id: number;
      userId: number;
      product: string;
      plan: string;
      amountInr: number;
      upiTransactionId: string;
      status: string;
      rejectionReason: string | null;
      reviewedAt: Date | null;
      createdAt: Date;
    },
    user?: { name: string; email: string },
  ): PaymentSubmissionView {
    return {
      id: row.id,
      user_id: row.userId,
      user_name: user?.name,
      user_email: user?.email,
      product: row.product,
      plan: row.plan,
      amount_inr: row.amountInr,
      upi_transaction_id: row.upiTransactionId,
      status: row.status as PaymentSubmissionStatus,
      rejection_reason: row.rejectionReason,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
