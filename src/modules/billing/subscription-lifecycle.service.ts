import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SuperAdminService } from '../../common/super-admin.service';
import { BillingNotificationService } from './billing-notification.service';

export type LifecycleUser = {
  id: number;
  name: string;
  email: string;
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
  subscriptionStatus: string;
  billingExpiringNotifiedFor: Date | null;
  billingExpiredNotifiedFor: Date | null;
};

type AccessWindow = {
  endsAt: Date;
  kind: 'trial' | 'subscription';
};

function sameInstant(a: Date | null | undefined, b: Date): boolean {
  return !!a && a.getTime() === b.getTime();
}

function daysUntil(date: Date, now: Date): number {
  const ms = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Daily job: remind tenants ~7 days before trial/period end, then notify once expired.
 * Idempotent via users.billing_expiring_notified_for / billing_expired_notified_for.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly superAdmin: SuperAdminService,
    private readonly notifications: BillingNotificationService,
  ) {}

  private billingEnabled(): boolean {
    return this.config.get<string>('BILLING_ENABLED', 'false') === 'true';
  }

  /** Days before end when the expiring reminder fires (default 7). */
  expiringDays(): number {
    const parsed = parseInt(this.config.get<string>('SUBSCRIPTION_EXPIRING_DAYS') ?? '7', 10);
    return Number.isNaN(parsed) || parsed < 1 ? 7 : Math.min(parsed, 30);
  }

  /** Resolve the active access end date (paid period preferred over trial). */
  resolveAccessWindow(user: LifecycleUser, now = new Date()): AccessWindow | null {
    const periodEnd = user.currentPeriodEnd;
    const trialEnds = user.trialEndsAt;
    const status = user.subscriptionStatus;

    if (status === 'pending_verification') {
      return null;
    }

    if (
      (status === 'active' || status === 'past_due' || status === 'cancelled') &&
      periodEnd &&
      periodEnd > now
    ) {
      return { endsAt: periodEnd, kind: 'subscription' };
    }

    if (trialEnds > now) {
      return { endsAt: trialEnds, kind: 'trial' };
    }

    return null;
  }

  /** Which end date caused expiry when the user no longer has an access window. */
  resolveExpiredAt(user: LifecycleUser, now = new Date()): AccessWindow | null {
    if (this.resolveAccessWindow(user, now)) return null;

    const periodEnd = user.currentPeriodEnd;
    if (periodEnd && periodEnd.getTime() <= now.getTime()) {
      return { endsAt: periodEnd, kind: 'subscription' };
    }
    if (user.trialEndsAt.getTime() <= now.getTime()) {
      return { endsAt: user.trialEndsAt, kind: 'trial' };
    }
    return null;
  }

  async processLifecycleReminders(): Promise<{ expiring: number; expired: number }> {
    if (!this.billingEnabled()) {
      this.logger.debug('Billing disabled — skip subscription lifecycle reminders');
      return { expiring: 0, expired: 0 };
    }

    const now = new Date();
    const windowDays = this.expiringDays();
    let expiring = 0;
    let expired = 0;

    const users: LifecycleUser[] = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: { in: ['trial', 'active', 'past_due', 'cancelled', 'expired'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        subscriptionStatus: true,
        billingExpiringNotifiedFor: true,
        billingExpiredNotifiedFor: true,
      },
    });

    for (const user of users) {
      if (this.superAdmin.isSuperAdmin(user.email)) continue;

      const access = this.resolveAccessWindow(user, now);

      if (access) {
        const daysLeft = daysUntil(access.endsAt, now);
        if (
          daysLeft >= 1 &&
          daysLeft <= windowDays &&
          !sameInstant(user.billingExpiringNotifiedFor, access.endsAt)
        ) {
          try {
            await this.notifications.notifySubscriptionExpiring({
              userId: user.id,
              to: user.email,
              name: user.name,
              kind: access.kind,
              endsAt: access.endsAt,
              daysLeft,
            });
            await this.prisma.user.update({
              where: { id: user.id },
              data: { billingExpiringNotifiedFor: access.endsAt },
            });
            expiring += 1;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Expiring notify failed user=${user.id}: ${message}`);
          }
        }
        continue;
      }

      if (user.subscriptionStatus === 'pending_verification') continue;

      const ended = this.resolveExpiredAt(user, now);
      if (!ended) continue;
      if (sameInstant(user.billingExpiredNotifiedFor, ended.endsAt)) continue;

      try {
        await this.notifications.notifySubscriptionExpired({
          userId: user.id,
          to: user.email,
          name: user.name,
          kind: ended.kind,
          endedAt: ended.endsAt,
        });

        const data: {
          billingExpiredNotifiedFor: Date;
          subscriptionStatus?: string;
        } = { billingExpiredNotifiedFor: ended.endsAt };

        if (user.subscriptionStatus !== 'expired' && user.subscriptionStatus !== 'cancelled') {
          data.subscriptionStatus = 'expired';
        }

        await this.prisma.user.update({
          where: { id: user.id },
          data,
        });
        expired += 1;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Expired notify failed user=${user.id}: ${message}`);
      }
    }

    this.logger.log(
      `Subscription lifecycle: expiring=${expiring} expired=${expired} (window=${windowDays}d)`,
    );
    return { expiring, expired };
  }
}
