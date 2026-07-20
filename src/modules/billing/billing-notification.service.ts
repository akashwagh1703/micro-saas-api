import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { OwnerNotificationsService } from '../notifications/owner-notifications.service';
import { OwnerNotificationType } from '../notifications/owner-notification.types';

@Injectable()
export class BillingNotificationService {
  private readonly logger = new Logger(BillingNotificationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly ownerNotifications: OwnerNotificationsService,
  ) {}

  isEnabled(): boolean {
    return this.mail.isEnabled();
  }

  private portalBillingUrl(): string {
    const portal = this.config.get<string>('PORTAL_URL')?.replace(/\/$/, '');
    return portal ? `${portal}/settings?tab=billing` : '';
  }

  private formatPeriod(periodEnd: Date): string {
    return periodEnd.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const result = await this.mail.send({ to, subject, text, html });
    if (!result.success) {
      this.logger.warn(`Billing email failed to=${to}: ${result.error ?? 'unknown'}`);
    }
  }

  private pushSubscriptionActivated(
    userId: number,
    plan: string,
    periodEnd: Date,
  ): void {
    const period = this.formatPeriod(periodEnd);
    void this.ownerNotifications.notify(userId, {
      type: OwnerNotificationType.SUBSCRIPTION_ACTIVATED,
      title: 'Subscription activated',
      body: `Your ${plan} plan is active until ${period}.`,
      metadata: {
        route: '/settings/billing',
        plan,
        period_end: periodEnd.toISOString(),
      },
      sendPush: true,
    });
  }

  /**
   * UPI manual approve: one email covering payment received + activation,
   * plus owner push for subscription activated (avoids double email).
   */
  async notifyPaymentApproved(params: {
    userId: number;
    to: string;
    name: string;
    plan: string;
    amountInr: number;
    periodEnd: Date;
  }) {
    const billingUrl = this.portalBillingUrl();
    const period = this.formatPeriod(params.periodEnd);
    const subject = 'AutoWave — payment received & subscription activated';
    const text = [
      `Hi ${params.name},`,
      '',
      `We received your UPI payment of ₹${params.amountInr} for the ${params.plan} plan.`,
      `Your subscription is now active until ${period}.`,
      '',
      billingUrl ? `Manage billing: ${billingUrl}` : 'You can go live on your auto-replies now.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
    this.pushSubscriptionActivated(params.userId, params.plan, params.periodEnd);
  }

  /** Razorpay (or other) — payment captured / charged. Email only. */
  async notifyPaymentReceived(params: {
    to: string;
    name: string;
    plan: string;
    amountInr: number;
    periodEnd?: Date | null;
    method?: string;
  }) {
    const billingUrl = this.portalBillingUrl();
    const methodLabel = params.method?.trim() || 'card';
    const periodLine = params.periodEnd
      ? `Your current period runs until ${this.formatPeriod(params.periodEnd)}.`
      : null;
    const subject = 'AutoWave — payment received';
    const text = [
      `Hi ${params.name},`,
      '',
      `We received your payment of ₹${params.amountInr} for the ${params.plan} plan (${methodLabel}).`,
      periodLine,
      '',
      billingUrl ? `Manage billing: ${billingUrl}` : null,
      '',
      '— AutoWave',
    ]
      .filter((line) => line !== null)
      .join('\n');

    await this.send(params.to, subject, text);
  }

  /** Razorpay subscription.activated / resumed — email + push. */
  async notifySubscriptionActivated(params: {
    userId: number;
    to: string;
    name: string;
    plan: string;
    periodEnd: Date;
  }) {
    const billingUrl = this.portalBillingUrl();
    const period = this.formatPeriod(params.periodEnd);
    const subject = 'AutoWave — subscription activated';
    const text = [
      `Hi ${params.name},`,
      '',
      `Your AutoWave ${params.plan} subscription is now active.`,
      `Access continues until ${period}.`,
      '',
      billingUrl ? `Manage billing: ${billingUrl}` : 'You are all set to use AutoWave.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
    this.pushSubscriptionActivated(params.userId, params.plan, params.periodEnd);
  }

  async notifyPaymentRejected(params: {
    to: string;
    name: string;
    plan: string;
    reason: string;
  }) {
    const billingUrl = this.portalBillingUrl();
    const subject = 'AutoWave — UPI payment could not be verified';
    const text = [
      `Hi ${params.name},`,
      '',
      `We could not verify your UPI payment for the ${params.plan} plan.`,
      `Reason: ${params.reason}`,
      '',
      billingUrl
        ? `You can submit again from Plan & billing: ${billingUrl}`
        : 'Please submit payment proof again from Plan & billing in the portal.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
  }

  async notifyPaymentExpired(params: { to: string; name: string; plan: string }) {
    const billingUrl = this.portalBillingUrl();
    const subject = 'AutoWave — payment verification expired';
    const text = [
      `Hi ${params.name},`,
      '',
      `Your UPI payment submission for the ${params.plan} plan was not verified in time and has expired.`,
      billingUrl
        ? `Please pay again and submit proof: ${billingUrl}`
        : 'Please pay again and submit proof from Plan & billing.',
      '',
      '— AutoWave',
    ].join('\n');

    await this.send(params.to, subject, text);
  }

  async notifyAdminDuplicateUtr(params: {
    utr: string;
    userId: number;
    userEmail: string;
  }) {
    const salesEmail = this.config.get<string>('SALES_EMAIL')?.trim();
    if (!salesEmail) return;

    const subject = `AutoWave — duplicate UPI UTR attempt (${params.utr})`;
    const text = [
      'A tenant tried to submit a UPI transaction ID that is already on file.',
      '',
      `UTR: ${params.utr}`,
      `User: ${params.userEmail} (id ${params.userId})`,
      '',
      'Review in Platform admin → UPI payments if needed.',
    ].join('\n');

    await this.send(salesEmail, subject, text);
  }

  /** Trial or paid period ending within the reminder window — email + push. */
  async notifySubscriptionExpiring(params: {
    userId: number;
    to: string;
    name: string;
    kind: 'trial' | 'subscription';
    endsAt: Date;
    daysLeft: number;
  }) {
    const billingUrl = this.portalBillingUrl();
    const when = this.formatPeriod(params.endsAt);
    const what = params.kind === 'trial' ? 'trial' : 'subscription';
    const dayLabel = params.daysLeft === 1 ? '1 day' : `${params.daysLeft} days`;
    const subject = `AutoWave — your ${what} expires in ${dayLabel}`;
    const text = [
      `Hi ${params.name},`,
      '',
      `Your AutoWave ${what} ends on ${when} (${dayLabel} left).`,
      'Renew or choose a plan to keep auto-replies and bookings running without interruption.',
      '',
      billingUrl ? `Manage billing: ${billingUrl}` : null,
      '',
      '— AutoWave',
    ]
      .filter((line) => line !== null)
      .join('\n');

    await this.send(params.to, subject, text);

    void this.ownerNotifications.notify(params.userId, {
      type: OwnerNotificationType.SUBSCRIPTION_EXPIRING,
      title: `Subscription expires in ${dayLabel}`,
      body:
        params.kind === 'trial'
          ? `Your trial ends on ${when}. Choose a plan to stay live.`
          : `Your plan ends on ${when}. Renew to keep access.`,
      metadata: {
        route: '/settings/billing',
        kind: params.kind,
        ends_at: params.endsAt.toISOString(),
        days_left: params.daysLeft,
      },
      sendPush: true,
    });
  }

  /** Access window ended — email + push. */
  async notifySubscriptionExpired(params: {
    userId: number;
    to: string;
    name: string;
    kind: 'trial' | 'subscription';
    endedAt: Date;
  }) {
    const billingUrl = this.portalBillingUrl();
    const when = this.formatPeriod(params.endedAt);
    const what = params.kind === 'trial' ? 'trial' : 'subscription';
    const subject = `AutoWave — your ${what} has expired`;
    const text = [
      `Hi ${params.name},`,
      '',
      `Your AutoWave ${what} ended on ${when}.`,
      'Choose a plan to restore access to auto-replies, inbox, and bookings.',
      '',
      billingUrl ? `Renew now: ${billingUrl}` : null,
      '',
      '— AutoWave',
    ]
      .filter((line) => line !== null)
      .join('\n');

    await this.send(params.to, subject, text);

    void this.ownerNotifications.notify(params.userId, {
      type: OwnerNotificationType.SUBSCRIPTION_EXPIRED,
      title: 'Subscription expired',
      body:
        params.kind === 'trial'
          ? `Your trial ended on ${when}. Choose a plan to continue.`
          : `Your plan ended on ${when}. Renew to restore access.`,
      metadata: {
        route: '/settings/billing',
        kind: params.kind,
        ended_at: params.endedAt.toISOString(),
      },
      sendPush: true,
    });
  }
}
