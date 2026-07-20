import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CareerProfile } from '@prisma/client';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerTenantSettingsService } from './career-tenant-settings.service';
import { CareerUpiConfigService } from './career-upi-config.service';
import { ManualPaymentExpiryService } from '../../billing/manual-payment-expiry.service';

export type SeekerBillingPlan = 'monthly' | 'yearly';
export type SeekerBillingStatusKind =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'cancelled'
  | 'pending_verification';

export interface SeekerBillingStatus {
  billing_enabled: boolean;
  status: SeekerBillingStatusKind;
  plan: SeekerBillingPlan | null;
  has_access: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  days_left: number | null;
  prices: { monthly_inr: number; yearly_inr: number };
  payment_mode: 'razorpay' | 'upi_manual' | 'both';
  upi_configured: boolean;
  razorpay_configured: boolean;
  pending_submission: {
    id: number;
    plan: string;
    amount_inr: number;
    upi_transaction_id: string;
    status: string;
    created_at: string;
    rejection_reason: string | null;
  } | null;
}

@Injectable()
export class CareerSeekerBillingService {
  private readonly logger = new Logger(CareerSeekerBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantSettings: CareerTenantSettingsService,
    private readonly upiConfig: CareerUpiConfigService,
    private readonly paymentExpiry: ManualPaymentExpiryService,
  ) {}

  async trialEndsAtForNewProfile(tenantUserId: number): Promise<Date> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    const ends = new Date();
    ends.setDate(ends.getDate() + cfg.trialDays);
    return ends;
  }

  private async getRazorpayForTenant(tenantUserId: number): Promise<Razorpay | null> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    if (!cfg.razorpayKeyId || !cfg.razorpayKeySecret) {
      return null;
    }
    return new Razorpay({
      key_id: cfg.razorpayKeyId,
      key_secret: cfg.razorpayKeySecret,
    });
  }

  private async isRazorpayConfiguredForTenant(tenantUserId: number): Promise<boolean> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    return this.tenantSettings.isSeekerRazorpayConfigured(cfg);
  }

  private async tenantKeySecret(tenantUserId: number): Promise<string | null> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    return cfg.razorpayKeySecret || null;
  }

  private async tenantKeyId(tenantUserId: number): Promise<string | null> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    return cfg.razorpayKeyId || null;
  }

  verifyWebhookSignature(body: Buffer | string, signature: string, secret: string): boolean {
    if (!secret) {
      return false;
    }
    const payload = typeof body === 'string' ? body : body.toString('utf8');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return expected === signature;
  }

  /** Verify tenant CareerAI webhook and apply subscription events. */
  async handleWebhookWithSignature(
    body: Buffer | string,
    signature: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const inner = (payload.payload as Record<string, unknown>) ?? {};
    const subscriptionEntity =
      ((inner.subscription as Record<string, unknown>)?.entity as Record<string, unknown>) ?? null;
    const paymentEntity =
      ((inner.payment as Record<string, unknown>)?.entity as Record<string, unknown>) ?? null;
    const entity = subscriptionEntity ?? paymentEntity ?? {};

    const tenantUserId = await this.resolveTenantFromWebhook(entity);
    if (!tenantUserId) {
      return false;
    }

    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    if (!cfg.razorpayWebhookSecret) {
      return false;
    }

    if (!this.verifyWebhookSignature(body, signature, cfg.razorpayWebhookSecret)) {
      return false;
    }

    const event = payload.event as string;
    await this.handleWebhookEvent(event, entity, paymentEntity);
    return true;
  }

  private async resolveTenantFromWebhook(entity: Record<string, unknown>): Promise<number | null> {
    const subscriptionId = entity.id as string | undefined;
    if (subscriptionId) {
      const profile = await this.prisma.careerProfile.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
        select: { userId: true },
      });
      if (profile) {
        return profile.userId;
      }
    }

    const notes = (entity.notes as Record<string, string>) ?? {};
    if (notes.product === 'career_seeker' && notes.user_id) {
      const userId = Number(notes.user_id);
      if (userId > 0) {
        return userId;
      }
    }

    return null;
  }

  async resolveStatus(
    profile: CareerProfile,
    pendingSubmission?: {
      id: number;
      plan: string;
      amountInr: number;
      upiTransactionId: string;
      status: string;
      createdAt: Date;
      rejectionReason: string | null;
    } | null,
  ): Promise<SeekerBillingStatus> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(profile.userId);
    const prices = {
      monthly_inr: cfg.priceMonthlyInr,
      yearly_inr: cfg.priceYearlyInr,
    };
    const razorpay_configured = await this.isRazorpayConfiguredForTenant(profile.userId);
    const upiPublic = await this.upiConfig.getPublicConfig(profile.userId);
    const pending_submission = pendingSubmission
      ? {
          id: pendingSubmission.id,
          plan: pendingSubmission.plan,
          amount_inr: pendingSubmission.amountInr,
          upi_transaction_id: pendingSubmission.upiTransactionId,
          status: pendingSubmission.status,
          created_at: pendingSubmission.createdAt.toISOString(),
          rejection_reason: pendingSubmission.rejectionReason,
        }
      : null;
    const base = {
      prices,
      payment_mode: cfg.paymentMode,
      upi_configured: upiPublic.upi_configured,
      razorpay_configured,
      pending_submission,
    };

    if (!cfg.enabled) {
      return {
        billing_enabled: false,
        status: 'active',
        plan: null,
        has_access: true,
        trial_ends_at: null,
        current_period_end: null,
        cancel_at_period_end: false,
        days_left: null,
        ...base,
      };
    }

    const now = new Date();
    const trialEnds = profile.trialEndsAt;
    const periodEnd = profile.currentPeriodEnd;
    const plan = (profile.subscriptionPlan as SeekerBillingPlan) ?? null;
    const cancelAtPeriodEnd = profile.subscriptionCancelAtPeriodEnd === true;
    const withinPaidPeriod = !!periodEnd && periodEnd > now;

    if (profile.subscriptionStatus === 'pending_verification') {
      return {
        billing_enabled: true,
        status: 'pending_verification',
        plan: (profile.subscriptionPlan as SeekerBillingPlan) ?? null,
        has_access: false,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd ? periodEnd.toISOString() : null,
        cancel_at_period_end: false,
        days_left: 0,
        ...base,
      };
    }

    if (profile.subscriptionStatus === 'active' && withinPaidPeriod) {
      return {
        billing_enabled: true,
        status: 'active',
        plan,
        has_access: true,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd!.toISOString(),
        cancel_at_period_end: cancelAtPeriodEnd,
        days_left: this.daysUntil(periodEnd!),
        ...base,
      };
    }

    if (profile.subscriptionStatus === 'past_due') {
      return {
        billing_enabled: true,
        status: 'past_due',
        plan,
        has_access: withinPaidPeriod,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd ? periodEnd.toISOString() : null,
        cancel_at_period_end: cancelAtPeriodEnd,
        days_left: withinPaidPeriod ? this.daysUntil(periodEnd!) : 0,
        ...base,
      };
    }

    if (profile.subscriptionStatus === 'cancelled') {
      return {
        billing_enabled: true,
        status: 'cancelled',
        plan,
        has_access: withinPaidPeriod,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd ? periodEnd.toISOString() : null,
        cancel_at_period_end: cancelAtPeriodEnd,
        days_left: withinPaidPeriod ? this.daysUntil(periodEnd!) : 0,
        ...base,
      };
    }

    if (trialEnds > now) {
      return {
        billing_enabled: true,
        status: 'trial',
        plan: null,
        has_access: true,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        days_left: this.daysUntil(trialEnds),
        ...base,
      };
    }

    return {
      billing_enabled: true,
      status: 'expired',
      plan: null,
      has_access: false,
      trial_ends_at: trialEnds.toISOString(),
      current_period_end: periodEnd ? periodEnd.toISOString() : null,
      cancel_at_period_end: false,
      days_left: 0,
      ...base,
    };
  }

  async hasAccess(profile: CareerProfile): Promise<boolean> {
    return (await this.resolveStatus(profile)).has_access;
  }

  async getStatusForProfile(
    profileId: number,
    tenantUserId: number,
    profileOverride?: CareerProfile,
  ): Promise<SeekerBillingStatus> {
    await this.paymentExpiry.expireStaleForCareerProfile(profileId);

    const profile =
      profileOverride ??
      (await this.prisma.careerProfile.findFirst({
        where: { id: profileId, userId: tenantUserId },
      }));
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }

    const latestSubmission = await this.prisma.paymentSubmission.findFirst({
      where: { profileId, userId: tenantUserId, product: 'career_seeker' },
      orderBy: { createdAt: 'desc' },
    });

    return this.resolveStatus(profile, latestSubmission);
  }

  estimatePeriodEndForPlan(plan: SeekerBillingPlan): Date {
    const periodEnd = new Date();
    if (plan === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }
    return periodEnd;
  }

  async recordManualSeekerTransaction(
    tenantUserId: number,
    data: {
      eventType: string;
      profileId: number;
      plan: SeekerBillingPlan | string;
      amountInr: number;
      upiTransactionId: string;
      paymentSubmissionId: number;
      status?: string;
    },
  ): Promise<void> {
    try {
      const existing = await this.prisma.billingTransaction.findFirst({
        where: {
          userId: tenantUserId,
          product: 'career_seeker',
          metadata: { path: ['payment_submission_id'], equals: data.paymentSubmissionId },
        },
      });
      if (existing) {
        return;
      }

      await this.prisma.billingTransaction.create({
        data: {
          userId: tenantUserId,
          product: 'career_seeker',
          eventType: data.eventType,
          plan: data.plan,
          amountInr: data.amountInr,
          status: data.status ?? 'captured',
          metadata: {
            profile_id: data.profileId,
            upi_transaction_id: data.upiTransactionId,
            payment_submission_id: data.paymentSubmissionId,
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record seeker manual transaction: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  private async planId(tenantUserId: number, plan: SeekerBillingPlan): Promise<string> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    const id = plan === 'monthly' ? cfg.razorpayPlanMonthly : cfg.razorpayPlanYearly;
    if (!id) {
      throw new ServiceUnavailableException(
        'CareerAI seeker subscription plans are not configured in Settings → CareerAI.',
      );
    }
    return id;
  }

  async createSubscription(profileId: number, tenantUserId: number, plan: SeekerBillingPlan) {
    const billingCfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    if (!billingCfg.enabled) {
      throw new UnprocessableEntityException('CareerAI seeker billing is not enabled for this account.');
    }
    if (billingCfg.paymentMode === 'upi_manual') {
      throw new UnprocessableEntityException(
        'Online checkout is not available. Pay via UPI on your CareerAI portal link.',
      );
    }

    const razorpay = await this.getRazorpayForTenant(tenantUserId);
    if (!razorpay || !(await this.isRazorpayConfiguredForTenant(tenantUserId))) {
      throw new ServiceUnavailableException(
        'Online payments are not configured. Add Razorpay credentials in Settings → CareerAI.',
      );
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: tenantUserId },
      include: { contact: true },
    });
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }

    const status = await this.resolveStatus(profile);
    if (status.status === 'active') {
      throw new UnprocessableEntityException('You already have an active CareerAI subscription.');
    }

    const email =
      profile.email?.trim() ||
      (profile.contact?.phone ? `${profile.contact.phone.replace(/\D/g, '')}@careerai.local` : null);
    const name = profile.fullName?.trim() || profile.contact?.name?.trim() || 'CareerAI User';

    let customerId = profile.razorpayCustomerId;
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name,
        email: email ?? undefined,
        contact: profile.contact?.phone ?? profile.phone ?? undefined,
      });
      customerId = customer.id;
      await this.prisma.careerProfile.update({
        where: { id: profileId },
        data: { razorpayCustomerId: customerId },
      });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: await this.planId(tenantUserId, plan),
      customer_id: customerId,
      customer_notify: 1,
      total_count: plan === 'yearly' ? 10 : 120,
      notes: {
        product: 'career_seeker',
        profile_id: String(profileId),
        user_id: String(tenantUserId),
        plan,
      },
    } as Parameters<Razorpay['subscriptions']['create']>[0]);

    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        razorpaySubscriptionId: subscription.id,
        subscriptionPlan: plan,
      },
    });

    return {
      subscription_id: subscription.id,
      key_id: (await this.tenantKeyId(tenantUserId)) ?? '',
      plan,
      amount_inr: plan === 'monthly' ? billingCfg.priceMonthlyInr : billingCfg.priceYearlyInr,
    };
  }

  async verifySubscriptionSignatureAsync(
    tenantUserId: number,
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): Promise<boolean> {
    const secret = await this.tenantKeySecret(tenantUserId);
    if (!secret) {
      return false;
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');
    return expected === signature;
  }

  async activateFromCheckout(
    profileId: number,
    tenantUserId: number,
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): Promise<SeekerBillingStatus> {
    if (!(await this.verifySubscriptionSignatureAsync(
      tenantUserId,
      paymentId,
      subscriptionId,
      signature,
    ))) {
      throw new ForbiddenException('Invalid payment signature.');
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: tenantUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }

    if (profile.razorpaySubscriptionId && profile.razorpaySubscriptionId !== subscriptionId) {
      throw new ForbiddenException('Subscription does not match this profile.');
    }

    const plan = (profile.subscriptionPlan as SeekerBillingPlan) ?? 'monthly';
    const periodEnd = new Date();
    if (plan === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const updated = await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        razorpaySubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        subscriptionPlan: plan,
        currentPeriodEnd: periodEnd,
        subscriptionCancelAtPeriodEnd: false,
      },
    });

    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    await this.recordSeekerTransaction(tenantUserId, {
      eventType: 'checkout.activated',
      profileId,
      razorpayPaymentId: paymentId,
      razorpaySubscriptionId: subscriptionId,
      plan,
      amountInr: plan === 'yearly' ? cfg.priceYearlyInr : cfg.priceMonthlyInr,
      status: 'captured',
    });

    return this.resolveStatus(updated);
  }

  /**
   * Cancels a candidate's subscription at the end of the current cycle (grace
   * period). Razorpay finalizes via the `subscription.cancelled` webhook.
   */
  async cancelSubscription(profileId: number, tenantUserId: number): Promise<SeekerBillingStatus> {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: tenantUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }
    if (!profile.razorpaySubscriptionId) {
      throw new UnprocessableEntityException('No active subscription to cancel.');
    }

    const razorpay = await this.getRazorpayForTenant(tenantUserId);
    if (!razorpay) {
      throw new ServiceUnavailableException('Online payments are not configured for this account.');
    }

    try {
      await razorpay.subscriptions.cancel(profile.razorpaySubscriptionId, true);
    } catch (err) {
      this.logger.error(
        `Seeker cancel failed profileId=${profileId}: ${(err as Error)?.message ?? 'unknown'}`,
      );
      throw new ServiceUnavailableException('Could not cancel the subscription. Please try again.');
    }

    const updated = await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: { subscriptionCancelAtPeriodEnd: true },
    });

    return this.resolveStatus(updated);
  }

  /** Records a candidate billing event in the shared ledger (product=career_seeker). */
  private async recordSeekerTransaction(
    tenantUserId: number,
    data: {
      eventType: string;
      profileId: number;
      razorpayPaymentId?: string | null;
      razorpaySubscriptionId?: string | null;
      plan?: SeekerBillingPlan | string | null;
      amountInr: number;
      status?: string;
    },
  ): Promise<void> {
    try {
      if (data.razorpayPaymentId) {
        const existing = await this.prisma.billingTransaction.findFirst({
          where: { razorpayPaymentId: data.razorpayPaymentId },
        });
        if (existing) {
          return;
        }
      }

      await this.prisma.billingTransaction.create({
        data: {
          userId: tenantUserId,
          product: 'career_seeker',
          eventType: data.eventType,
          razorpayPaymentId: data.razorpayPaymentId ?? null,
          razorpaySubscriptionId: data.razorpaySubscriptionId ?? null,
          plan: data.plan ?? null,
          amountInr: data.amountInr,
          status: data.status ?? 'captured',
          metadata: { profile_id: data.profileId },
        },
      });
    } catch (err) {
      this.logger.warn(`Could not record seeker transaction: ${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  /** Called from Razorpay webhook when subscription is not linked to a platform User. */
  async handleWebhookEvent(
    event: string,
    entity: Record<string, unknown>,
    paymentEntity: Record<string, unknown> | null = null,
  ): Promise<boolean> {
    const subscriptionId = entity.id as string | undefined;
    if (!subscriptionId) {
      return false;
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { razorpaySubscriptionId: subscriptionId },
    });

    if (!profile) {
      const notes = (entity.notes as Record<string, string>) ?? {};
      if (notes.product !== 'career_seeker' || !notes.profile_id) {
        return false;
      }
      const profileId = Number(notes.profile_id);
      if (!profileId) {
        return false;
      }
      await this.applySubscriptionEvent(profileId, event, entity, subscriptionId, paymentEntity);
      return true;
    }

    await this.applySubscriptionEvent(profile.id, event, entity, subscriptionId, paymentEntity);
    return true;
  }

  private async applySubscriptionEvent(
    profileId: number,
    event: string,
    entity: Record<string, unknown>,
    subscriptionId: string,
    paymentEntity: Record<string, unknown> | null = null,
  ): Promise<void> {
    const planNote = (entity.notes as Record<string, string>)?.plan;
    const currentEnd = entity.current_end
      ? new Date(Number(entity.current_end) * 1000)
      : null;

    switch (event) {
      case 'subscription.authenticated':
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed': {
        const profile = await this.prisma.careerProfile.findUnique({ where: { id: profileId } });
        const plan =
          (planNote as SeekerBillingPlan) ??
          ((profile?.subscriptionPlan as SeekerBillingPlan) ?? 'monthly');
        const periodEnd =
          currentEnd ??
          (() => {
            const d = new Date();
            if (plan === 'yearly') {
              d.setFullYear(d.getFullYear() + 1);
            } else {
              d.setMonth(d.getMonth() + 1);
            }
            return d;
          })();

        await this.prisma.careerProfile.update({
          where: { id: profileId },
          data: {
            razorpaySubscriptionId: subscriptionId,
            subscriptionStatus: 'active',
            subscriptionPlan: plan,
            currentPeriodEnd: periodEnd,
            subscriptionCancelAtPeriodEnd: false,
          },
        });
        this.logger.log(`Seeker subscription activated profileId=${profileId}`);

        if (event === 'subscription.charged' && profile) {
          const cfg = await this.tenantSettings.getSeekerBillingConfig(profile.userId);
          const amountPaise = Number(paymentEntity?.amount ?? 0);
          const amountInr =
            amountPaise > 0
              ? Math.round(amountPaise / 100)
              : plan === 'yearly'
                ? cfg.priceYearlyInr
                : cfg.priceMonthlyInr;
          await this.recordSeekerTransaction(profile.userId, {
            eventType: event,
            profileId,
            razorpayPaymentId: (paymentEntity?.id as string) ?? null,
            razorpaySubscriptionId: subscriptionId,
            plan,
            amountInr,
            status: (paymentEntity?.status as string) ?? 'captured',
          });
        }
        break;
      }
      // Charge failed; Razorpay retrying. Keep grace access until currentPeriodEnd.
      case 'subscription.pending':
      case 'subscription.halted':
        await this.prisma.careerProfile.update({
          where: { id: profileId },
          data: { subscriptionStatus: 'past_due' },
        });
        this.logger.log(`Seeker subscription past_due profileId=${profileId} event=${event}`);
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
        await this.prisma.careerProfile.update({
          where: { id: profileId },
          data: {
            subscriptionStatus: 'cancelled',
            subscriptionCancelAtPeriodEnd: false,
          },
        });
        this.logger.log(`Seeker subscription ended profileId=${profileId} event=${event}`);
        break;
      default:
        break;
    }
  }

  async formatWhatsAppStatus(profile: CareerProfile): Promise<string> {
    const status = await this.resolveStatus(profile);
    if (!status.billing_enabled) {
      return 'CareerAI access is included — no subscription required.';
    }

    const lines = ['*Your CareerAI plan*', ''];

    if (status.status === 'pending_verification') {
      lines.push(
        '⏳ *Payment under review*',
        'Your UPI payment is being verified. CareerAI access is paused until approval.',
        '',
        'You will get a confirmation once verified (usually within 24 hours).',
      );
      return lines.join('\n');
    }

    if (status.status === 'trial') {
      lines.push(
        `🎁 *Free trial* — ${status.days_left} day${status.days_left === 1 ? '' : 's'} left`,
        `Trial ends: ${this.formatDate(status.trial_ends_at)}`,
        '',
        `After trial: ₹${status.prices.monthly_inr}/mo or ₹${status.prices.yearly_inr}/yr`,
        'Reply *SUBSCRIBE* for a payment link.',
      );
      return lines.join('\n');
    }

    if (status.status === 'active') {
      lines.push(`✅ *Active* — ${status.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan`);
      if (status.cancel_at_period_end && status.current_period_end) {
        lines.push(`Cancellation scheduled — access until ${this.formatDate(status.current_period_end)}`);
      } else if (status.current_period_end) {
        lines.push(`Renews: ${this.formatDate(status.current_period_end)}`);
      }
      return lines.filter(Boolean).join('\n');
    }

    if (status.status === 'past_due') {
      lines.push(
        '⚠️ *Payment issue* — we could not charge your card',
        status.has_access && status.current_period_end
          ? `Access continues until ${this.formatDate(status.current_period_end)}.`
          : 'Access is paused until payment succeeds.',
        '',
        'Reply *SUBSCRIBE* to update your payment and stay active.',
      );
      return lines.filter(Boolean).join('\n');
    }

    if (status.status === 'cancelled' && status.has_access && status.current_period_end) {
      lines.push(
        '🚫 *Cancellation scheduled*',
        `You still have access until ${this.formatDate(status.current_period_end)}.`,
        '',
        'Reply *SUBSCRIBE* to reactivate anytime.',
      );
      return lines.filter(Boolean).join('\n');
    }

    lines.push(
      status.status === 'cancelled' ? '❌ *Subscription ended*' : '⏰ *Trial ended*',
      '',
      `Subscribe to continue job matching, mock interviews & AI guidance:`,
      `• Monthly — ₹${status.prices.monthly_inr}/mo`,
      `• Yearly — ₹${status.prices.yearly_inr}/yr`,
      '',
      'Reply *SUBSCRIBE* for your payment link.',
    );
    return lines.join('\n');
  }

  private formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  private daysUntil(date: Date): number {
    const ms = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
}
