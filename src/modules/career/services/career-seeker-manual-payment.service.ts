import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProofStorageService } from '../../billing/payment-proof-storage.service';
import { PlatformAuditService } from '../../billing/platform-audit.service';
import { ManualPaymentExpiryService } from '../../billing/manual-payment-expiry.service';
import {
  CareerSeekerBillingService,
  SeekerBillingPlan,
} from './career-seeker-billing.service';
import { CareerUpiConfigService } from './career-upi-config.service';
import { CareerTenantSettingsService } from './career-tenant-settings.service';
import { CareerEmailService } from './career-email.service';

export type CareerPaymentSubmissionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface CareerSeekerPaymentSubmissionView {
  id: number;
  user_id: number;
  profile_id: number;
  profile_name?: string;
  profile_email?: string;
  profile_phone?: string;
  product: string;
  plan: string;
  amount_inr: number;
  upi_transaction_id: string;
  status: CareerPaymentSubmissionStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

@Injectable()
export class CareerSeekerManualPaymentService {
  private readonly logger = new Logger(CareerSeekerManualPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seekerBilling: CareerSeekerBillingService,
    private readonly proofStorage: PaymentProofStorageService,
    private readonly upiConfig: CareerUpiConfigService,
    private readonly tenantSettings: CareerTenantSettingsService,
    private readonly audit: PlatformAuditService,
    private readonly expiry: ManualPaymentExpiryService,
    private readonly careerEmail: CareerEmailService,
  ) {}

  async getPaymentConfig(tenantUserId: number, portalToken?: string) {
    const cfg = await this.upiConfig.getPublicConfig(tenantUserId);
    if (portalToken?.trim()) {
      const qrUrl = this.upiConfig.resolveSeekerQrUrl(tenantUserId, portalToken.trim());
      return { ...cfg, upi_qr_url: qrUrl, upi_configured: !!(cfg.upi_vpa && qrUrl) };
    }
    return cfg;
  }

  async getLatestSubmissionForProfile(
    profileId: number,
    tenantUserId: number,
  ): Promise<CareerSeekerPaymentSubmissionView | null> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { profileId, userId: tenantUserId, product: 'career_seeker' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toView(row) : null;
  }

  async submitManualPayment(
    profileId: number,
    tenantUserId: number,
    plan: SeekerBillingPlan,
    upiTransactionId: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    const billingCfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    if (!billingCfg.enabled) {
      throw new UnprocessableEntityException('CareerAI seeker billing is not enabled.');
    }
    if (billingCfg.paymentMode === 'razorpay') {
      throw new UnprocessableEntityException('UPI manual payments are not enabled for this account.');
    }
    await this.upiConfig.assertUpiConfigured(tenantUserId);

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

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: tenantUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }

    await this.expiry.expireStaleForCareerProfile(profileId);

    const refreshed = await this.prisma.careerProfile.findUniqueOrThrow({ where: { id: profileId } });
    const current = await this.seekerBilling.resolveStatus(refreshed);

    if (current.status === 'active') {
      throw new UnprocessableEntityException('You already have an active CareerAI subscription.');
    }
    if (current.status === 'pending_verification') {
      throw new UnprocessableEntityException(
        'A payment is already under review. Wait for verification or contact your career coach.',
      );
    }

    const duplicate = await this.prisma.paymentSubmission.findFirst({
      where: {
        product: 'career_seeker',
        upiTransactionId: utr,
        status: { in: ['pending', 'approved'] },
      },
    });
    if (duplicate) {
      await this.audit.log({
        action: 'career_seeker.duplicate_utr',
        targetUserId: tenantUserId,
        paymentSubmissionId: duplicate.id,
        details: {
          upi_transaction_id: utr,
          existing_status: duplicate.status,
          profile_id: duplicate.profileId,
        },
      });
      await this.notifyOperatorDuplicateUtr(tenantUserId, utr, profileId);
      throw new UnprocessableEntityException({
        message:
          'This UPI transaction ID was already submitted. Use a different reference or contact support.',
        code: 'duplicate_utr',
      });
    }

    const amountInr = plan === 'monthly' ? billingCfg.priceMonthlyInr : billingCfg.priceYearlyInr;

    const submission = await this.prisma.paymentSubmission.create({
      data: {
        userId: tenantUserId,
        profileId,
        product: 'career_seeker',
        plan,
        amountInr,
        upiTransactionId: utr,
        screenshotToken: 'pending',
        status: 'pending',
      },
    });

    const { token } = await this.proofStorage.saveProof(
      tenantUserId,
      submission.id,
      file.buffer,
      file.mimetype,
    );

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: { screenshotToken: token },
    });

    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        subscriptionStatus: 'pending_verification',
        subscriptionPlan: plan,
      },
    });

    this.logger.log(
      `Career seeker manual payment submitted profileId=${profileId} tenantUserId=${tenantUserId} plan=${plan} utr=${utr}`,
    );

    await this.audit.log({
      action: 'career_seeker.submitted',
      targetUserId: tenantUserId,
      paymentSubmissionId: submission.id,
      details: { profile_id: profileId, plan, amount_inr: amountInr, upi_transaction_id: utr },
    });

    const updated = await this.prisma.paymentSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });

    const statusProfile = await this.prisma.careerProfile.findUniqueOrThrow({ where: { id: profileId } });
    return {
      submission: this.toView(updated),
      status: await this.seekerBilling.getStatusForProfile(profileId, tenantUserId, statusProfile),
    };
  }

  async listSubmissions(
    tenantUserId: number,
    params: { status?: string; page?: number; perPage?: number },
  ) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
    const where: Prisma.PaymentSubmissionWhereInput = {
      product: 'career_seeker',
      userId: tenantUserId,
    };
    if (params.status?.trim()) {
      where.status = params.status.trim();
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentSubmission.findMany({
        where,
        include: {
          profile: { select: { fullName: true, email: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.paymentSubmission.count({ where }),
    ]);

    return {
      data: rows.map((r) =>
        this.toView(r, {
          name: r.profile?.fullName ?? undefined,
          email: r.profile?.email ?? undefined,
          phone: r.profile?.phone ?? undefined,
        }),
      ),
      total,
      page,
      per_page: perPage,
    };
  }

  async getSubmission(tenantUserId: number, id: number): Promise<CareerSeekerPaymentSubmissionView> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { id, product: 'career_seeker', userId: tenantUserId },
      include: {
        profile: { select: { fullName: true, email: true, phone: true } },
      },
    });
    if (!row) throw new NotFoundException('Payment submission not found');
    return this.toView(row, {
      name: row.profile?.fullName ?? undefined,
      email: row.profile?.email ?? undefined,
      phone: row.profile?.phone ?? undefined,
    });
  }

  async readSubmissionScreenshot(
    tenantUserId: number,
    id: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await this.prisma.paymentSubmission.findFirst({
      where: { id, product: 'career_seeker', userId: tenantUserId },
    });
    if (!row) throw new NotFoundException('Payment submission not found');
    const file = await this.proofStorage.readProof(row.userId, row.id, row.screenshotToken);
    if (!file) throw new NotFoundException('Screenshot not found');
    return file;
  }

  async approveSubmission(tenantUserId: number, submissionId: number) {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: 'career_seeker', userId: tenantUserId },
      include: {
        profile: { select: { id: true, fullName: true, email: true, trialEndsAt: true } },
      },
    });
    if (!submission?.profileId) throw new NotFoundException('Payment submission not found');
    if (submission.status !== 'pending') {
      throw new UnprocessableEntityException(`Submission is already ${submission.status}.`);
    }

    const utrConflict = await this.prisma.paymentSubmission.findFirst({
      where: {
        product: 'career_seeker',
        upiTransactionId: submission.upiTransactionId,
        status: 'approved',
        id: { not: submission.id },
      },
    });
    if (utrConflict) {
      await this.audit.log({
        action: 'career_seeker.approve_blocked_duplicate_utr',
        targetUserId: tenantUserId,
        paymentSubmissionId: submission.id,
        details: {
          upi_transaction_id: submission.upiTransactionId,
          conflict_submission_id: utrConflict.id,
          profile_id: submission.profileId,
        },
      });
      throw new UnprocessableEntityException(
        'This UPI transaction ID was already approved on another submission.',
      );
    }

    const plan = submission.plan as SeekerBillingPlan;
    const periodEnd = this.seekerBilling.estimatePeriodEndForPlan(plan);

    await this.prisma.careerProfile.update({
      where: { id: submission.profileId },
      data: {
        subscriptionStatus: 'active',
        subscriptionPlan: plan,
        currentPeriodEnd: periodEnd,
        subscriptionCancelAtPeriodEnd: false,
      },
    });

    await this.seekerBilling.recordManualSeekerTransaction(tenantUserId, {
      eventType: 'manual.approved',
      profileId: submission.profileId,
      plan,
      amountInr: submission.amountInr,
      upiTransactionId: submission.upiTransactionId,
      paymentSubmissionId: submission.id,
    });

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `Career seeker payment approved submission=${submissionId} profileId=${submission.profileId}`,
    );

    await this.audit.log({
      action: 'career_seeker.approved',
      targetUserId: tenantUserId,
      paymentSubmissionId: submission.id,
      details: {
        profile_id: submission.profileId,
        plan,
        amount_inr: submission.amountInr,
        upi_transaction_id: submission.upiTransactionId,
        operator_user_id: tenantUserId,
      },
    });

    if (submission.profile?.email) {
      await this.careerEmail.send({
        to: submission.profile.email,
        subject: 'CareerAI subscription activated',
        text: [
          `Hi ${submission.profile.fullName || 'there'},`,
          '',
          `Your UPI payment for the ${plan} CareerAI plan has been verified.`,
          `Access is active until ${periodEnd.toLocaleDateString('en-IN')}.`,
          '',
          'You can continue using CareerAI on WhatsApp.',
        ].join('\n'),
      });
    }

    return {
      submission: await this.getSubmission(tenantUserId, submission.id),
      profile_status: await this.seekerBilling.getStatusForProfile(
        submission.profileId,
        tenantUserId,
      ),
    };
  }

  async rejectSubmission(tenantUserId: number, submissionId: number, reason: string) {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: 'career_seeker', userId: tenantUserId },
      include: {
        profile: { select: { id: true, fullName: true, email: true, trialEndsAt: true } },
      },
    });
    if (!submission?.profileId) throw new NotFoundException('Payment submission not found');
    if (submission.status !== 'pending') {
      throw new UnprocessableEntityException(`Submission is already ${submission.status}.`);
    }

    const trimmedReason = reason.trim().slice(0, 500) || 'Payment could not be verified.';
    const trialStillValid =
      submission.profile?.trialEndsAt && submission.profile.trialEndsAt > new Date();

    await this.prisma.careerProfile.update({
      where: { id: submission.profileId },
      data: {
        subscriptionStatus: trialStillValid ? 'trial' : 'expired',
        subscriptionPlan: trialStillValid ? null : submission.plan,
        currentPeriodEnd: null,
      },
    });

    await this.prisma.paymentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'rejected',
        rejectionReason: trimmedReason,
        reviewedAt: new Date(),
      },
    });

    await this.seekerBilling.recordManualSeekerTransaction(tenantUserId, {
      eventType: 'manual.rejected',
      profileId: submission.profileId,
      plan: submission.plan as SeekerBillingPlan,
      amountInr: submission.amountInr,
      upiTransactionId: submission.upiTransactionId,
      paymentSubmissionId: submission.id,
      status: 'rejected',
    });

    await this.audit.log({
      action: 'career_seeker.rejected',
      targetUserId: tenantUserId,
      paymentSubmissionId: submission.id,
      details: {
        profile_id: submission.profileId,
        plan: submission.plan,
        reason: trimmedReason,
        upi_transaction_id: submission.upiTransactionId,
        operator_user_id: tenantUserId,
      },
    });

    if (submission.profile?.email) {
      await this.careerEmail.send({
        to: submission.profile.email,
        subject: 'CareerAI payment could not be verified',
        text: [
          `Hi ${submission.profile.fullName || 'there'},`,
          '',
          `We could not verify your UPI payment for the ${submission.plan} plan.`,
          `Reason: ${trimmedReason}`,
          '',
          'Open your CareerAI portal link from WhatsApp to submit again with the correct UTR and screenshot.',
        ].join('\n'),
      });
    }

    return {
      submission: await this.getSubmission(tenantUserId, submission.id),
      profile_status: await this.seekerBilling.getStatusForProfile(
        submission.profileId,
        tenantUserId,
      ),
    };
  }

  private async notifyOperatorDuplicateUtr(
    tenantUserId: number,
    utr: string,
    profileId: number,
  ): Promise<void> {
    const operator = await this.prisma.user.findUnique({
      where: { id: tenantUserId },
      select: { email: true, name: true },
    });
    if (!operator?.email) return;

    await this.careerEmail.send({
      to: operator.email,
      subject: 'Duplicate UPI transaction ID — CareerAI seeker payment',
      text: [
        `Hi ${operator.name || 'there'},`,
        '',
        `A job seeker (profile #${profileId}) tried to submit UPI transaction ID ${utr},`,
        'but that reference is already pending or approved on another submission.',
        '',
        'Review payment submissions in CareerAI → Payments.',
      ].join('\n'),
    });
  }

  private toView(
    row: {
      id: number;
      userId: number;
      profileId: number | null;
      product: string;
      plan: string;
      amountInr: number;
      upiTransactionId: string;
      status: string;
      rejectionReason: string | null;
      reviewedAt: Date | null;
      createdAt: Date;
    },
    profile?: { name?: string; email?: string; phone?: string },
  ): CareerSeekerPaymentSubmissionView {
    return {
      id: row.id,
      user_id: row.userId,
      profile_id: row.profileId ?? 0,
      profile_name: profile?.name,
      profile_email: profile?.email,
      profile_phone: profile?.phone,
      product: row.product,
      plan: row.plan,
      amount_inr: row.amountInr,
      upi_transaction_id: row.upiTransactionId,
      status: row.status as CareerPaymentSubmissionStatus,
      rejection_reason: row.rejectionReason,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
