import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerProfile } from '@prisma/client';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerTenantSettingsService } from './career-tenant-settings.service';

export type SeekerBillingPlan = 'monthly' | 'yearly';
export type SeekerBillingStatusKind = 'trial' | 'active' | 'expired' | 'cancelled';

export interface SeekerBillingStatus {
  billing_enabled: boolean;
  status: SeekerBillingStatusKind;
  plan: SeekerBillingPlan | null;
  has_access: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  days_left: number | null;
  prices: { monthly_inr: number; yearly_inr: number };
  razorpay_configured: boolean;
}

@Injectable()
export class CareerSeekerBillingService {
  private readonly logger = new Logger(CareerSeekerBillingService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantSettings: CareerTenantSettingsService,
  ) {}

  async trialEndsAtForNewProfile(tenantUserId: number): Promise<Date> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    const ends = new Date();
    ends.setDate(ends.getDate() + cfg.trialDays);
    return ends;
  }

  private getRazorpay(): Razorpay | null {
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) {
      return null;
    }
    if (!this.razorpay) {
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this.razorpay;
  }

  private isPlatformRazorpayReady(): boolean {
    return !!(
      this.config.get<string>('RAZORPAY_KEY_ID') &&
      this.config.get<string>('RAZORPAY_KEY_SECRET')
    );
  }

  private async isRazorpayConfiguredForTenant(tenantUserId: number): Promise<boolean> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(tenantUserId);
    return (
      this.isPlatformRazorpayReady() &&
      !!(cfg.razorpayPlanMonthly && cfg.razorpayPlanYearly)
    );
  }

  async resolveStatus(profile: CareerProfile): Promise<SeekerBillingStatus> {
    const cfg = await this.tenantSettings.getSeekerBillingConfig(profile.userId);
    const prices = {
      monthly_inr: cfg.priceMonthlyInr,
      yearly_inr: cfg.priceYearlyInr,
    };
    const razorpay_configured = await this.isRazorpayConfiguredForTenant(profile.userId);

    if (!cfg.enabled) {
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

    const now = new Date();
    const trialEnds = profile.trialEndsAt;
    const periodEnd = profile.currentPeriodEnd;

    if (
      profile.subscriptionStatus === 'active' &&
      periodEnd &&
      periodEnd > now
    ) {
      return {
        billing_enabled: true,
        status: 'active',
        plan: (profile.subscriptionPlan as SeekerBillingPlan) ?? null,
        has_access: true,
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: periodEnd.toISOString(),
        days_left: this.daysUntil(periodEnd),
        prices,
        razorpay_configured,
      };
    }

    if (profile.subscriptionStatus === 'cancelled') {
      return {
        billing_enabled: true,
        status: 'cancelled',
        plan: (profile.subscriptionPlan as SeekerBillingPlan) ?? null,
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

  async hasAccess(profile: CareerProfile): Promise<boolean> {
    return (await this.resolveStatus(profile)).has_access;
  }

  async getStatusForProfile(profileId: number, tenantUserId: number): Promise<SeekerBillingStatus> {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: tenantUserId },
    });
    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }
    return this.resolveStatus(profile);
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

    const razorpay = this.getRazorpay();
    if (!razorpay || !(await this.isRazorpayConfiguredForTenant(tenantUserId))) {
      throw new ServiceUnavailableException(
        'Online payments are not configured. Contact support to subscribe.',
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
      key_id: this.config.get<string>('RAZORPAY_KEY_ID'),
      plan,
      amount_inr: plan === 'monthly' ? billingCfg.priceMonthlyInr : billingCfg.priceYearlyInr,
    };
  }

  verifySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    const secret = this.config.get<string>('RAZORPAY_KEY_SECRET');
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
    if (!this.verifySubscriptionSignature(paymentId, subscriptionId, signature)) {
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
      },
    });

    return this.resolveStatus(updated);
  }

  /** Called from Razorpay webhook when subscription is not linked to a platform User. */
  async handleWebhookEvent(event: string, entity: Record<string, unknown>): Promise<boolean> {
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
      await this.applySubscriptionEvent(profileId, event, entity, subscriptionId);
      return true;
    }

    await this.applySubscriptionEvent(profile.id, event, entity, subscriptionId);
    return true;
  }

  private async applySubscriptionEvent(
    profileId: number,
    event: string,
    entity: Record<string, unknown>,
    subscriptionId: string,
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
          },
        });
        this.logger.log(`Seeker subscription activated profileId=${profileId}`);
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.halted':
        await this.prisma.careerProfile.update({
          where: { id: profileId },
          data: { subscriptionStatus: 'cancelled' },
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
      lines.push(
        `✅ *Active* — ${status.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan`,
        status.current_period_end
          ? `Renews: ${this.formatDate(status.current_period_end)}`
          : '',
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
