import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, User } from '@prisma/client';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from '../../prisma/prisma.service';
import { SuperAdminService } from '../../common/super-admin.service';

export type BillingPlan = 'monthly' | 'yearly';
export type BillingStatusKind = 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled';

export interface BillingStatus {
  billing_enabled: boolean;
  status: BillingStatusKind;
  plan: BillingPlan | null;
  has_access: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  /** When true, the subscription is set to cancel at `current_period_end`. */
  cancel_at_period_end: boolean;
  days_left: number | null;
  prices: { monthly_inr: number; yearly_inr: number };
  razorpay_configured: boolean;
  razorpay_webhook_url: string;
}

export interface BillingTransactionView {
  id: number;
  event_type: string;
  plan: string | null;
  amount_inr: number;
  currency: string;
  status: string;
  razorpay_payment_id: string | null;
  created_at: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('BILLING_ENABLED', 'false') === 'true';
  }

  trialDays(): number {
    return Number(this.config.get<string>('BILLING_TRIAL_DAYS', '14'));
  }

  monthlyPriceInr(): number {
    return Number(this.config.get<string>('PLATFORM_PRICE_MONTHLY_INR', '99'));
  }

  yearlyPriceInr(): number {
    return Number(this.config.get<string>('PLATFORM_PRICE_YEARLY_INR', '999'));
  }

  private getRazorpay(): Razorpay | null {
    const keyId = this.env('RAZORPAY_KEY_ID');
    const keySecret = this.env('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) return null;
    if (!this.razorpay) {
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this.razorpay;
  }

  isRazorpayConfigured(): boolean {
    return !!(
      this.env('RAZORPAY_KEY_ID') &&
      this.env('RAZORPAY_KEY_SECRET') &&
      this.env('RAZORPAY_PLAN_MONTHLY') &&
      this.env('RAZORPAY_PLAN_YEARLY')
    );
  }

  getRazorpayWebhookUrl(): string {
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${appUrl}/api/webhook/razorpay`;
  }

  private env(key: string): string {
    return (this.config.get<string>(key) ?? '').trim();
  }

  trialEndsAtForNewUser(): Date {
    const ends = new Date();
    ends.setDate(ends.getDate() + this.trialDays());
    return ends;
  }

  async getUser(userId: number): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('User not found');
    return user;
  }

  resolveStatus(user: User): BillingStatus {
    const now = new Date();
    const prices = { monthly_inr: this.monthlyPriceInr(), yearly_inr: this.yearlyPriceInr() };
    const razorpay_configured = this.isRazorpayConfigured();
    const razorpay_webhook_url = this.getRazorpayWebhookUrl();
    const base = { prices, razorpay_configured, razorpay_webhook_url };

    if (this.superAdmin.isSuperAdmin(user.email)) {
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

    if (!this.isEnabled()) {
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

    const trialEnds = user.trialEndsAt;
    const periodEnd = user.currentPeriodEnd;
    const plan = (user.subscriptionPlan as BillingPlan) ?? null;
    const cancelAtPeriodEnd = user.subscriptionCancelAtPeriodEnd === true;
    const withinPaidPeriod = !!periodEnd && periodEnd > now;

    if (user.subscriptionStatus === 'active' && withinPaidPeriod) {
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

    // Payment failing (Razorpay pending/halted): keep access during the grace
    // window the user already paid for, then expire.
    if (user.subscriptionStatus === 'past_due') {
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

    // Cancelled: honor the remaining paid period (grace) before cutting access.
    if (user.subscriptionStatus === 'cancelled') {
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

  async getStatus(userId: number): Promise<BillingStatus> {
    const user = await this.getUser(userId);
    return this.resolveStatus(user);
  }

  async hasPlatformAccess(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    if (this.superAdmin.isSuperAdmin(user.email)) return true;
    if (!this.isEnabled()) return true;
    return this.resolveStatus(user).has_access;
  }

  async assertPlatformAccess(userId: number): Promise<void> {
    if (await this.hasPlatformAccess(userId)) return;
    throw new ForbiddenException({
      message: 'Your free trial has ended. Subscribe to continue using AutoWave.',
      code: 'subscription_required',
    });
  }

  private daysUntil(date: Date): number {
    const ms = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  private planId(plan: BillingPlan): string {
    const key = plan === 'monthly' ? 'RAZORPAY_PLAN_MONTHLY' : 'RAZORPAY_PLAN_YEARLY';
    const id = this.env(key);
    if (!id) {
      throw new ServiceUnavailableException(
        'Subscription plans are not configured. Set RAZORPAY_PLAN_MONTHLY and RAZORPAY_PLAN_YEARLY in server env.',
      );
    }
    return id;
  }

  private razorpayErrorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { description?: string; code?: string }; statusCode?: number };
    if (e?.statusCode === 401) {
      return 'Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server env.';
    }
    return e?.error?.description ?? fallback;
  }

  private isRazorpayRetryableCustomerError(err: unknown): boolean {
    const e = err as { statusCode?: number; error?: { code?: string; description?: string } };
    if (e?.statusCode !== 400 || e?.error?.code !== 'BAD_REQUEST_ERROR') {
      return false;
    }
    const desc = (e.error.description ?? '').toLowerCase();
    return desc.includes('customer') || desc.includes('id provided is invalid');
  }

  private async fetchRazorpayPaymentDetails(
    paymentId: string,
  ): Promise<{ amountInr: number; status: string } | null> {
    const razorpay = this.getRazorpay();
    if (!razorpay) return null;
    try {
      const payment = await razorpay.payments.fetch(paymentId);
      return {
        amountInr: Math.round(Number(payment.amount) / 100),
        status: String(payment.status ?? 'captured'),
      };
    } catch (err) {
      this.logger.warn(
        `Could not fetch Razorpay payment ${paymentId}: ${this.razorpayErrorMessage(err, 'unknown')}`,
      );
      return null;
    }
  }

  private async fetchRazorpaySubscriptionPeriodEnd(subscriptionId: string): Promise<Date | null> {
    const razorpay = this.getRazorpay();
    if (!razorpay) return null;
    try {
      const subscription = await razorpay.subscriptions.fetch(subscriptionId);
      if (subscription.current_end) {
        return new Date(Number(subscription.current_end) * 1000);
      }
    } catch (err) {
      this.logger.warn(
        `Could not fetch Razorpay subscription ${subscriptionId}: ${this.razorpayErrorMessage(err, 'unknown')}`,
      );
    }
    return null;
  }

  private estimatePeriodEnd(plan: BillingPlan): Date {
    const periodEnd = new Date();
    if (plan === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }
    return periodEnd;
  }

  async createSubscription(userId: number, plan: BillingPlan) {
    if (!this.isEnabled()) {
      throw new UnprocessableEntityException('Billing is not enabled.');
    }

    const razorpay = this.getRazorpay();
    if (!razorpay || !this.isRazorpayConfigured()) {
      throw new ServiceUnavailableException(
        'Online payments are not configured. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and plan IDs in server env.',
      );
    }

    let user = await this.getUser(userId);
    const status = this.resolveStatus(user);
    if (status.status === 'active') {
      throw new UnprocessableEntityException('You already have an active subscription.');
    }

    try {
      return await this.createSubscriptionCheckout(userId, plan, user, razorpay);
    } catch (err) {
      if (user.razorpayCustomerId && this.isRazorpayRetryableCustomerError(err)) {
        this.logger.warn(
          `Resetting stale Razorpay customer for userId=${userId}: ${this.razorpayErrorMessage(err, '')}`,
        );
        await this.prisma.user.update({
          where: { id: userId },
          data: { razorpayCustomerId: null, razorpaySubscriptionId: null },
        });
        user = await this.getUser(userId);
        try {
          return await this.createSubscriptionCheckout(userId, plan, user, razorpay);
        } catch (retryErr) {
          this.logger.error(
            `Subscribe retry failed userId=${userId}: ${this.razorpayErrorMessage(retryErr, 'Unknown error')}`,
          );
          throw new ServiceUnavailableException(
            this.razorpayErrorMessage(retryErr, 'Could not start subscription checkout.'),
          );
        }
      }

      this.logger.error(
        `Subscribe failed userId=${userId}: ${this.razorpayErrorMessage(err, 'Unknown error')}`,
      );
      throw new ServiceUnavailableException(
        this.razorpayErrorMessage(err, 'Could not start subscription checkout.'),
      );
    }
  }

  private async createSubscriptionCheckout(
    userId: number,
    plan: BillingPlan,
    user: User,
    razorpay: Razorpay,
  ) {
    let customerId = user.razorpayCustomerId;
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: user.name,
        email: user.email,
      });
      customerId = customer.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { razorpayCustomerId: customerId },
      });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: this.planId(plan),
      customer_id: customerId,
      customer_notify: 1,
      total_count: plan === 'yearly' ? 10 : 120,
      notes: { product: 'platform', user_id: String(userId), plan },
    } as Parameters<Razorpay['subscriptions']['create']>[0]);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        razorpaySubscriptionId: subscription.id,
        subscriptionPlan: plan,
      },
    });

    return {
      subscription_id: subscription.id,
      key_id: this.env('RAZORPAY_KEY_ID'),
      plan,
      amount_inr: plan === 'monthly' ? this.monthlyPriceInr() : this.yearlyPriceInr(),
    };
  }

  verifySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    const secret = this.env('RAZORPAY_KEY_SECRET');
    if (!secret) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');
    return expected === signature;
  }

  async activateFromCheckout(
    userId: number,
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ) {
    if (!this.verifySubscriptionSignature(paymentId, subscriptionId, signature)) {
      throw new ForbiddenException('Invalid payment signature.');
    }

    const user = await this.getUser(userId);
    if (user.razorpaySubscriptionId && user.razorpaySubscriptionId !== subscriptionId) {
      throw new ForbiddenException('Subscription does not match your account.');
    }

    const plan = (user.subscriptionPlan as BillingPlan) ?? 'monthly';
    const periodEnd =
      (await this.fetchRazorpaySubscriptionPeriodEnd(subscriptionId)) ??
      this.estimatePeriodEnd(plan);

    const paymentDetails = await this.fetchRazorpayPaymentDetails(paymentId);
    const amountInr =
      paymentDetails?.amountInr ??
      (plan === 'monthly' ? this.monthlyPriceInr() : this.yearlyPriceInr());

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        razorpaySubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        subscriptionPlan: plan,
        currentPeriodEnd: periodEnd,
      },
    });

    await this.recordTransaction({
      userId,
      eventType: 'checkout.activated',
      razorpayPaymentId: paymentId,
      razorpaySubscriptionId: subscriptionId,
      plan,
      amountInr,
      status: paymentDetails?.status ?? 'captured',
    });

    return this.getStatus(userId);
  }

  /**
   * Cancels the subscription at the end of the current billing cycle so the user
   * keeps access until `currentPeriodEnd`. Razorpay sends `subscription.cancelled`
   * when the cycle ends, which finalizes the local status.
   */
  async cancelSubscription(userId: number): Promise<BillingStatus> {
    if (!this.isEnabled()) {
      throw new UnprocessableEntityException('Billing is not enabled.');
    }

    const user = await this.getUser(userId);
    if (!user.razorpaySubscriptionId) {
      throw new UnprocessableEntityException('You do not have an active subscription to cancel.');
    }

    const razorpay = this.getRazorpay();
    if (!razorpay) {
      throw new ServiceUnavailableException('Online payments are not configured.');
    }

    try {
      // `true` => cancel_at_cycle_end so access continues until the paid period ends.
      await razorpay.subscriptions.cancel(user.razorpaySubscriptionId, true);
    } catch (err) {
      this.logger.error(
        `Cancel failed userId=${userId}: ${this.razorpayErrorMessage(err, 'Unknown error')}`,
      );
      throw new ServiceUnavailableException(
        this.razorpayErrorMessage(err, 'Could not cancel the subscription. Please try again.'),
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionCancelAtPeriodEnd: true },
    });

    await this.recordTransaction({
      userId,
      eventType: 'subscription.cancel_requested',
      razorpaySubscriptionId: user.razorpaySubscriptionId,
      plan: (user.subscriptionPlan as BillingPlan) ?? null,
      amountInr: 0,
      status: 'cancel_scheduled',
      metadata: { source: 'self_service' },
    });

    return this.getStatus(userId);
  }

  /** Receipt/transaction history for the operator's billing page. */
  async getTransactions(userId: number, limit = 50): Promise<BillingTransactionView[]> {
    const rows = await this.prisma.billingTransaction.findMany({
      where: { userId, product: 'platform' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return rows.map((t) => ({
      id: t.id,
      event_type: t.eventType,
      plan: t.plan,
      amount_inr: t.amountInr,
      currency: t.currency,
      status: t.status,
      razorpay_payment_id: t.razorpayPaymentId,
      created_at: t.createdAt.toISOString(),
    }));
  }

  verifyWebhookSignature(body: Buffer | string, signature: string): boolean {
    const secret = this.env('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return expected === signature;
  }

  async handleWebhookEvent(event: string, webhookBody: Record<string, unknown>): Promise<boolean> {
    this.logger.log(`Razorpay webhook: ${event}`);

    const inner = (webhookBody.payload as Record<string, unknown>) ?? {};
    const subscriptionWrap = inner.subscription as { entity?: Record<string, unknown> } | undefined;
    const paymentWrap = inner.payment as { entity?: Record<string, unknown> } | undefined;
    const subscriptionEntity = subscriptionWrap?.entity;
    const paymentEntity = paymentWrap?.entity;
    const entity =
      subscriptionEntity ??
      paymentEntity ??
      (webhookBody.entity as Record<string, unknown>) ??
      webhookBody;

    const subscriptionId =
      (subscriptionEntity?.id as string) ??
      (entity?.subscription_id as string) ??
      (entity?.id as string) ??
      (webhookBody.subscription_id as string);

    if (!subscriptionId) {
      this.logger.warn('Webhook missing subscription id');
      return false;
    }

    const notes =
      (subscriptionEntity?.notes as Record<string, string>) ??
      (entity?.notes as Record<string, string>) ??
      {};

    if (notes.product === 'career_seeker') {
      return false;
    }

    let user = await this.prisma.user.findFirst({
      where: { razorpaySubscriptionId: subscriptionId },
    });

    if (!user) {
      const userId = notes.user_id ? Number(notes.user_id) : null;
      if (!userId) {
        this.logger.warn(`No user for subscription ${subscriptionId}`);
        return false;
      }
      user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        this.logger.warn(`Webhook user_id ${userId} not found for subscription ${subscriptionId}`);
        return false;
      }
    }

    const subscriptionForEvent = subscriptionEntity ?? entity;
    await this.applySubscriptionEvent(user.id, event, subscriptionForEvent, subscriptionId);

    if (event === 'subscription.charged') {
      const freshUser = await this.prisma.user.findUnique({ where: { id: user.id } });
      const plan =
        (notes.plan as BillingPlan) ??
        ((freshUser?.subscriptionPlan as BillingPlan) ?? 'monthly');
      const amountPaise =
        Number(paymentEntity?.amount ?? entity?.amount ?? 0) ||
        (plan === 'yearly' ? this.yearlyPriceInr() : this.monthlyPriceInr()) * 100;

      await this.recordTransaction({
        userId: user.id,
        eventType: event,
        razorpayPaymentId: (paymentEntity?.id as string) ?? null,
        razorpaySubscriptionId: subscriptionId,
        plan,
        amountInr: Math.round(amountPaise / 100),
        status: (paymentEntity?.status as string) ?? 'captured',
        metadata: { source: 'webhook' },
      });
    }

    return true;
  }

  private async recordTransaction(data: {
    userId: number;
    eventType: string;
    razorpayPaymentId?: string | null;
    razorpaySubscriptionId?: string | null;
    plan?: BillingPlan | string | null;
    amountInr: number;
    status?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (data.razorpayPaymentId) {
      const existing = await this.prisma.billingTransaction.findFirst({
        where: { razorpayPaymentId: data.razorpayPaymentId },
      });
      if (existing) return existing;
    }

    return this.prisma.billingTransaction.create({
      data: {
        userId: data.userId,
        product: 'platform',
        eventType: data.eventType,
        razorpayPaymentId: data.razorpayPaymentId ?? null,
        razorpaySubscriptionId: data.razorpaySubscriptionId ?? null,
        plan: data.plan ?? null,
        amountInr: data.amountInr,
        status: data.status ?? 'captured',
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  private async applySubscriptionEvent(
    userId: number,
    event: string,
    entity: Record<string, unknown>,
    subscriptionId: string,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      this.logger.warn(`applySubscriptionEvent: user ${userId} not found`);
      return;
    }

    const planNote = (entity?.notes as Record<string, string>)?.plan;
    const currentEnd = entity.current_end
      ? new Date(Number(entity.current_end) * 1000)
      : null;

    switch (event) {
      case 'subscription.authenticated':
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed': {
        const plan =
          (planNote as BillingPlan) ??
          ((existing.subscriptionPlan as BillingPlan) ?? 'monthly');
        const periodEnd = currentEnd ?? this.estimatePeriodEnd(plan);

        await this.prisma.user.update({
          where: { id: userId },
          data: {
            razorpaySubscriptionId: subscriptionId,
            subscriptionStatus: 'active',
            subscriptionPlan: plan,
            currentPeriodEnd: periodEnd,
            subscriptionCancelAtPeriodEnd: false,
          },
        });
        break;
      }
      // A charge failed; Razorpay is retrying. Keep access during the grace
      // window (governed by currentPeriodEnd) so the user can fix their card.
      case 'subscription.pending':
      case 'subscription.halted':
        await this.prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'past_due' },
        });
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionStatus: 'cancelled',
            subscriptionCancelAtPeriodEnd: false,
          },
        });
        break;
      default:
        break;
    }
  }
}
