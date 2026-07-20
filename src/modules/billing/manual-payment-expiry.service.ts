import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingNotificationService } from './billing-notification.service';
import { PlatformAuditService } from './platform-audit.service';
import { CareerEmailService } from '../career/services/career-email.service';

@Injectable()
export class ManualPaymentExpiryService {
  private readonly logger = new Logger(ManualPaymentExpiryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly notifications: BillingNotificationService,
    @Optional()
    @Inject(forwardRef(() => CareerEmailService))
    private readonly careerEmail?: CareerEmailService,
  ) {}

  pendingDays(): number {
    const parsed = parseInt(this.config.get<string>('MANUAL_PAYMENT_PENDING_DAYS') ?? '7', 10);
    return Number.isNaN(parsed) || parsed < 1 ? 7 : Math.min(parsed, 90);
  }

  private cutoffDate(): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.pendingDays());
    return cutoff;
  }

  /** Expire stale pending submissions for one user (lazy, on status check). */
  async expireStaleForUser(userId: number): Promise<number> {
    const stale = await this.prisma.paymentSubmission.findMany({
      where: {
        userId,
        product: 'platform',
        status: 'pending',
        createdAt: { lt: this.cutoffDate() },
      },
    });

    let count = 0;
    for (const row of stale) {
      if (await this.expireSubmission(row.id)) count += 1;
    }
    return count;
  }

  /** Expire stale pending career seeker submissions for one profile (lazy). */
  async expireStaleForCareerProfile(profileId: number): Promise<number> {
    const stale = await this.prisma.paymentSubmission.findMany({
      where: {
        profileId,
        product: 'career_seeker',
        status: 'pending',
        createdAt: { lt: this.cutoffDate() },
      },
    });

    let count = 0;
    for (const row of stale) {
      if (await this.expireCareerSubmission(row.id)) count += 1;
    }
    return count;
  }

  /** Cron: expire all stale pending platform and career seeker submissions. */
  async expireStalePendingSubmissions(): Promise<number> {
    const cutoff = this.cutoffDate();
    const stale = await this.prisma.paymentSubmission.findMany({
      where: {
        product: { in: ['platform', 'career_seeker'] },
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      select: { id: true, product: true },
    });

    let count = 0;
    for (const row of stale) {
      if (row.product === 'career_seeker') {
        if (await this.expireCareerSubmission(row.id)) count += 1;
      } else if (await this.expireSubmission(row.id)) {
        count += 1;
      }
    }

    if (count > 0) {
      this.logger.log(`Expired ${count} stale UPI payment submission(s)`);
    }
    return count;
  }

  private async expireSubmission(submissionId: number): Promise<boolean> {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: 'platform', status: 'pending' },
      include: { user: { select: { id: true, name: true, email: true, subscriptionStatus: true, trialEndsAt: true } } },
    });
    if (!submission) return false;

    const trialStillValid = submission.user.trialEndsAt > new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentSubmission.update({
        where: { id: submission.id },
        data: { status: 'expired' },
      });

      if (submission.user.subscriptionStatus === 'pending_verification') {
        const otherPending = await tx.paymentSubmission.count({
          where: {
            userId: submission.userId,
            product: 'platform',
            status: 'pending',
            id: { not: submission.id },
          },
        });

        if (otherPending === 0) {
          await tx.user.update({
            where: { id: submission.userId },
            data: {
              subscriptionStatus: trialStillValid ? 'trial' : 'expired',
              subscriptionPlan: trialStillValid ? null : submission.plan,
              currentPeriodEnd: null,
            },
          });
        }
      }
    });

    await this.audit.log({
      action: 'payment.expired',
      targetUserId: submission.userId,
      paymentSubmissionId: submission.id,
      details: {
        plan: submission.plan,
        upi_transaction_id: submission.upiTransactionId,
        pending_days: this.pendingDays(),
      },
    });

    await this.notifications.notifyPaymentExpired({
      to: submission.user.email,
      name: submission.user.name,
      plan: submission.plan,
    });

    return true;
  }

  private async expireCareerSubmission(submissionId: number): Promise<boolean> {
    const submission = await this.prisma.paymentSubmission.findFirst({
      where: { id: submissionId, product: 'career_seeker', status: 'pending' },
      include: {
        profile: {
          select: {
            id: true,
            fullName: true,
            email: true,
            subscriptionStatus: true,
            trialEndsAt: true,
          },
        },
      },
    });
    if (!submission?.profileId || !submission.profile) return false;

    const trialStillValid = submission.profile.trialEndsAt > new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentSubmission.update({
        where: { id: submission.id },
        data: { status: 'expired' },
      });

      if (submission.profile!.subscriptionStatus === 'pending_verification') {
        const otherPending = await tx.paymentSubmission.count({
          where: {
            profileId: submission.profileId,
            product: 'career_seeker',
            status: 'pending',
            id: { not: submission.id },
          },
        });

        if (otherPending === 0) {
          await tx.careerProfile.update({
            where: { id: submission.profileId! },
            data: {
              subscriptionStatus: trialStillValid ? 'trial' : 'expired',
              subscriptionPlan: trialStillValid ? null : submission.plan,
              currentPeriodEnd: null,
            },
          });
        }
      }
    });

    await this.audit.log({
      action: 'career_seeker.expired',
      targetUserId: submission.userId,
      paymentSubmissionId: submission.id,
      details: {
        profile_id: submission.profileId,
        plan: submission.plan,
        upi_transaction_id: submission.upiTransactionId,
        pending_days: this.pendingDays(),
      },
    });

    if (submission.profile.email && this.careerEmail) {
      await this.careerEmail.send({
        to: submission.profile.email,
        subject: 'CareerAI payment verification expired',
        text: [
          `Hi ${submission.profile.fullName || 'there'},`,
          '',
          `Your UPI payment submission for the ${submission.plan} plan was not verified within ${this.pendingDays()} days and has expired.`,
          '',
          'Open your CareerAI portal link from WhatsApp to submit payment again.',
        ].join('\n'),
      });
    }

    return true;
  }
}
