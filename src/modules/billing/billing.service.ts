import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from '../../prisma/prisma.service';

export type BillingPlan = 'monthly' | 'yearly';
export type BillingStatusKind = 'trial' | 'active' | 'expired' | 'cancelled';

export interface BillingStatus {
  billing_enabled: boolean;
  status: BillingStatusKind;
  plan: BillingPlan | null;
  has_access: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  days_left: number | null;
  prices: { monthly_inr: number; yearly_inr: number };
  razorpay_configured: boolean;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('BILLING_ENABLED', 'false') === 'true';
  }

  trialDays(): number {
    return Number(this.config.get<string>('BILLING_TRIAL_DAYS', '14'));
  }

  monthlyPriceInr(): number {
    return Number(this.config.get<string>('PLATFORM_PRICE_MONTHLY_INR', '499'));
  }

  yearlyPriceInr(): number {
    return Number(this.config.get<string>('PLATFORM_PRICE_YEARLY_INR', '4999'));
  }

  private getRazorpay(): Razorpay | null {
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) return null;
    if (!this.razorpay) {
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this.razorpay;
  }

  isRazorpayConfigured(): boolean {
    return !!(
      this.config.get<string>('RAZORPAY_KEY_ID') &&
      this.config.get<string>('RAZORPAY_KEY_SECRET') &&
      this.config.get<string>('RAZORPAY_PLAN_MONTHLY') &&
      this.config.get<string>('RAZORPAY_PLAN_YEARLY')
    );
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

    if (!this.isEnabled()) {
      return {
        billing_enabled: false,
        status: 'active',
        plan: null,
        has_access: true,
        trial_ends_at: null,
        current_period_end: null,
        days_left: null,
        prices,
        razorpay_configured,
      };
    }

    const trialEnds = user.trialEndsAt;
    const periodEnd = user.currentPeriodEnd;

    if (
      user.subscriptionStatus === 'active' &&
      periodEnd &&
      periodEnd > now
    ) {
      return {
        billing_enabled: true,
        status: 'active',
        plan: (user.subscriptionPlan as BillingPlan) ?? null,
        has_access: true,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd.toISOString(),
        days_left: this.daysUntil(periodEnd),
        prices,
        razorpay_configured,
      };
    }

    if (user.subscriptionStatus === 'cancelled') {
      return {
        billing_enabled: true,
        status: 'cancelled',
        plan: (user.subscriptionPlan as BillingPlan) ?? null,
        has_access: false,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd ? periodEnd.toISOString() : null,
        days_left: 0,
        prices,
        razorpay_configured,
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
        days_left: this.daysUntil(trialEnds),
        prices,
        razorpay_configured,
      };
    }

    return {
      billing_enabled: true,
      status: 'expired',
      plan: null,
      has_access: false,
      trial_ends_at: trialEnds.toISOString(),
      current_period_end: periodEnd ? periodEnd.toISOString() : null,
      days_left: 0,
      prices,
      razorpay_configured,
    };
  }

  async getStatus(userId: number): Promise<BillingStatus> {
    const user = await this.getUser(userId);
    return this.resolveStatus(user);
  }

  async hasPlatformAccess(userId: number): Promise<boolean> {
    if (!this.isEnabled()) return true;
    const user = await this.getUser(userId);
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
    const id = this.config.get<string>(key);
    if (!id) {
      throw new ServiceUnavailableException('Subscription plans are not configured yet.');
    }
    return id;
  }

  async createSubscription(userId: number, plan: BillingPlan) {
    if (!this.isEnabled()) {
      throw new UnprocessableEntityException('Billing is not enabled.');
    }

    const razorpay = this.getRazorpay();
    if (!razorpay || !this.isRazorpayConfigured()) {
      throw new ServiceUnavailableException(
        'Online payments are not configured. Contact support to subscribe.',
      );
    }

    const user = await this.getUser(userId);
    const status = this.resolveStatus(user);
    if (status.status === 'active') {
      throw new UnprocessableEntityException('You already have an active subscription.');
    }

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
      notes: { user_id: String(userId), plan },
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
      key_id: this.config.get<string>('RAZORPAY_KEY_ID'),
      plan,
      amount_inr: plan === 'monthly' ? this.monthlyPriceInr() : this.yearlyPriceInr(),
    };
  }

  verifySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    const secret = this.config.get<string>('RAZORPAY_KEY_SECRET');
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
    const periodEnd = new Date();
    if (plan === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        razorpaySubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        subscriptionPlan: plan,
        currentPeriodEnd: periodEnd,
      },
    });

    return this.getStatus(userId);
  }

  verifyWebhookSignature(body: Buffer | string, signature: string): boolean {
    const secret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return expected === signature;
  }

  async handleWebhookEvent(event: string, payload: Record<string, unknown>): Promise<boolean> {
    this.logger.log(`Razorpay webhook: ${event}`);

    const entity = (payload?.entity as Record<string, unknown>) ?? payload;
    const nestedSub = payload?.subscription as { entity?: { id?: string } } | undefined;
    const subscriptionId =
      (entity?.id as string) ??
      (payload?.subscription_id as string) ??
      nestedSub?.entity?.id;

    if (!subscriptionId) {
      this.logger.warn('Webhook missing subscription id');
      return false;
    }

    const user = await this.prisma.user.findFirst({
      where: { razorpaySubscriptionId: subscriptionId },
    });

    if (!user) {
      const notes = (entity?.notes as Record<string, string>) ?? {};
      const userId = notes.user_id ? Number(notes.user_id) : null;
      if (!userId) {
        this.logger.warn(`No user for subscription ${subscriptionId}`);
        return false;
      }
      await this.applySubscriptionEvent(userId, event, entity, subscriptionId);
      return true;
    }

    await this.applySubscriptionEvent(user.id, event, entity, subscriptionId);
    return true;
  }

  private async applySubscriptionEvent(
    userId: number,
    event: string,
    entity: Record<string, unknown>,
    subscriptionId: string,
  ) {
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
          ((await this.getUser(userId)).subscriptionPlan as BillingPlan) ??
          'monthly';
        const periodEnd =
          currentEnd ??
          (() => {
            const d = new Date();
            if (plan === 'yearly') d.setFullYear(d.getFullYear() + 1);
            else d.setMonth(d.getMonth() + 1);
            return d;
          })();

        await this.prisma.user.update({
          where: { id: userId },
          data: {
            razorpaySubscriptionId: subscriptionId,
            subscriptionStatus: 'active',
            subscriptionPlan: plan,
            currentPeriodEnd: periodEnd,
          },
        });
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.halted':
        await this.prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'cancelled' },
        });
        break;
      default:
        break;
    }
  }
}
