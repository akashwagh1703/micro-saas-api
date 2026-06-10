import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { SuperAdminService } from '../../common/super-admin.service';
import { UpdateUserAccessDto } from './dto/admin.dto';

type DayCount = { day: Date; count: number };
type DayRevenue = { day: Date; total: number };

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  private formatInr(amount: number): number {
    return Math.round(amount);
  }

  private fillDaySeries(
    days: number,
    rows: { day: Date; value: number }[],
  ): { day: string; value: number }[] {
    const map = new Map(
      rows.map((r) => [r.day.toISOString().slice(0, 10), r.value]),
    );
    const result: { day: string; value: number }[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (days - 1));

    for (let i = 0; i < days; i++) {
      const key = cursor.toISOString().slice(0, 10);
      result.push({ day: key, value: map.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  async getOverview() {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      newThisWeek,
      activeSubscriptions,
      onTrial,
      expiredOrCancelled,
      revenueAllTime,
      revenueMtd,
      activeMonthly,
      activeYearly,
      whatsappConnected,
      recentTransactions,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.user.count({ where: { subscriptionStatus: 'active' } }),
      this.prisma.user.count({
        where: {
          subscriptionStatus: { not: 'active' },
          trialEndsAt: { gt: now },
        },
      }),
      this.prisma.user.count({
        where: { subscriptionStatus: { in: ['expired', 'cancelled'] } },
      }),
      this.prisma.billingTransaction.aggregate({
        where: { product: 'platform', status: 'captured' },
        _sum: { amountInr: true },
      }),
      this.prisma.billingTransaction.aggregate({
        where: {
          product: 'platform',
          status: 'captured',
          createdAt: { gte: monthStart },
        },
        _sum: { amountInr: true },
      }),
      this.prisma.user.count({
        where: { subscriptionStatus: 'active', subscriptionPlan: 'monthly' },
      }),
      this.prisma.user.count({
        where: { subscriptionStatus: 'active', subscriptionPlan: 'yearly' },
      }),
      this.prisma.whatsAppAccount.count({ where: { isConnected: true } }),
      this.prisma.billingTransaction.findMany({
        where: { product: 'platform' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const mrr =
      activeMonthly * this.billing.monthlyPriceInr() +
      activeYearly * Math.round(this.billing.yearlyPriceInr() / 12);

    return {
      total_users: totalUsers,
      new_this_week: newThisWeek,
      active_subscriptions: activeSubscriptions,
      on_trial: onTrial,
      expired_or_cancelled: expiredOrCancelled,
      whatsapp_connected: whatsappConnected,
      revenue_all_time_inr: this.formatInr(revenueAllTime._sum.amountInr ?? 0),
      revenue_mtd_inr: this.formatInr(revenueMtd._sum.amountInr ?? 0),
      mrr_inr: this.formatInr(mrr),
      plan_breakdown: {
        monthly: activeMonthly,
        yearly: activeYearly,
      },
      prices: {
        monthly_inr: this.billing.monthlyPriceInr(),
        yearly_inr: this.billing.yearlyPriceInr(),
      },
      recent_transactions: recentTransactions.map((t) => ({
        id: t.id,
        user_id: t.userId,
        user_name: t.user.name,
        user_email: t.user.email,
        plan: t.plan,
        amount_inr: t.amountInr,
        status: t.status,
        event_type: t.eventType,
        created_at: t.createdAt.toISOString(),
      })),
    };
  }

  async getAnalytics(days = 30) {
    const safeDays = Math.min(90, Math.max(7, days));
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (safeDays - 1));

    const [signupRows, revenueRows, statusGroups, planGroups] = await Promise.all([
      this.prisma.$queryRaw<DayCount[]>`
        SELECT DATE(created_at) as day, COUNT(*)::int as count
        FROM users
        WHERE created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `,
      this.prisma.$queryRaw<DayRevenue[]>`
        SELECT DATE(created_at) as day, COALESCE(SUM(amount_inr), 0)::int as total
        FROM billing_transactions
        WHERE created_at >= ${since}
          AND product = 'platform'
          AND status = 'captured'
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `,
      this.prisma.user.groupBy({
        by: ['subscriptionStatus'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['subscriptionPlan'],
        where: { subscriptionStatus: 'active' },
        _count: { _all: true },
      }),
    ]);

    const signups = this.fillDaySeries(
      safeDays,
      signupRows.map((r) => ({
        day: new Date(r.day),
        value: Number(r.count),
      })),
    );

    const revenue = this.fillDaySeries(
      safeDays,
      revenueRows.map((r) => ({
        day: new Date(r.day),
        value: Number(r.total),
      })),
    );

    const status_breakdown = Object.fromEntries(
      statusGroups.map((g) => [g.subscriptionStatus ?? 'unknown', g._count._all]),
    );

    const plan_breakdown = {
      monthly: 0,
      yearly: 0,
      none: 0,
    };
    for (const g of planGroups) {
      if (g.subscriptionPlan === 'monthly') plan_breakdown.monthly = g._count._all;
      else if (g.subscriptionPlan === 'yearly') plan_breakdown.yearly = g._count._all;
      else plan_breakdown.none += g._count._all;
    }

    return {
      days: safeDays,
      signups,
      revenue,
      status_breakdown,
      plan_breakdown,
    };
  }

  async listTransactions(page = 1, search = '', status = '') {
    const perPage = 25;
    const skip = (Math.max(1, page) - 1) * perPage;
    const term = search.trim();

    const where: Prisma.BillingTransactionWhereInput = {
      product: 'platform',
    };

    if (status) {
      where.status = status;
    }

    if (term) {
      where.OR = [
        { razorpayPaymentId: { contains: term, mode: 'insensitive' } },
        { razorpaySubscriptionId: { contains: term, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [items, total, sumResult] = await Promise.all([
      this.prisma.billingTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.billingTransaction.count({ where }),
      this.prisma.billingTransaction.aggregate({
        where: { ...where, status: 'captured' },
        _sum: { amountInr: true },
      }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        user_id: t.userId,
        user_name: t.user.name,
        user_email: t.user.email,
        event_type: t.eventType,
        plan: t.plan,
        amount_inr: t.amountInr,
        currency: t.currency,
        status: t.status,
        razorpay_payment_id: t.razorpayPaymentId,
        razorpay_subscription_id: t.razorpaySubscriptionId,
        created_at: t.createdAt.toISOString(),
      })),
      total,
      page,
      per_page: perPage,
      total_amount_inr: this.formatInr(sumResult._sum.amountInr ?? 0),
    };
  }

  async listUsers(page = 1, search = '', status = '', plan = '') {
    const perPage = 20;
    const skip = (Math.max(1, page) - 1) * perPage;
    const term = search.trim();

    const where: Prisma.UserWhereInput = {};

    if (term) {
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (status === 'trial') {
      where.subscriptionStatus = { not: 'active' };
      where.trialEndsAt = { gt: new Date() };
    } else if (status) {
      where.subscriptionStatus = status;
    }

    if (plan === 'none') {
      where.subscriptionPlan = null;
    } else if (plan) {
      where.subscriptionPlan = plan;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        select: {
          id: true,
          name: true,
          email: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          razorpayCustomerId: true,
          razorpaySubscriptionId: true,
          createdAt: true,
          whatsAppAccount: { select: { isConnected: true, displayPhoneNumber: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = users.map((u) => u.id);
    const businessSettings =
      userIds.length > 0
        ? await this.prisma.userSetting.findMany({
            where: { userId: { in: userIds }, key: 'business_category' },
            select: { userId: true, value: true },
          })
        : [];

    const businessByUser = Object.fromEntries(
      businessSettings.map((s) => [s.userId, s.value]),
    );

    const items = await Promise.all(
      users.map(async (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        is_super_admin: this.superAdmin.isSuperAdmin(u.email),
        subscription_status: u.subscriptionStatus,
        subscription_plan: u.subscriptionPlan,
        trial_ends_at: u.trialEndsAt?.toISOString() ?? null,
        current_period_end: u.currentPeriodEnd?.toISOString() ?? null,
        created_at: u.createdAt?.toISOString() ?? null,
        business_category: businessByUser[u.id] ?? null,
        whatsapp_connected: u.whatsAppAccount?.isConnected ?? false,
        whatsapp_display: u.whatsAppAccount?.displayPhoneNumber ?? null,
        razorpay_customer_id: u.razorpayCustomerId,
        razorpay_subscription_id: u.razorpaySubscriptionId,
        billing: await this.billing.getStatus(u.id),
      })),
    );

    return {
      items,
      total,
      page,
      per_page: perPage,
    };
  }

  async getUserDetail(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        whatsAppAccount: { select: { isConnected: true, displayPhoneNumber: true } },
        instagramAccount: { select: { isConnected: true, username: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [contacts, workflows, messages, leads, careerProfiles, settings, transactions] =
      await Promise.all([
        this.prisma.contact.count({ where: { userId } }),
        this.prisma.workflow.count({ where: { userId } }),
        this.prisma.message.count({ where: { userId } }),
        this.prisma.lead.count({ where: { userId } }),
        this.prisma.careerProfile.count({ where: { userId } }),
        this.prisma.userSetting.findMany({
          where: {
            userId,
            key: { in: ['business_category', 'use_cases', 'use_case'] },
          },
        }),
        this.prisma.billingTransaction.findMany({
          where: { userId, product: 'platform' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      is_super_admin: this.superAdmin.isSuperAdmin(user.email),
      created_at: user.createdAt?.toISOString() ?? null,
      subscription_status: user.subscriptionStatus,
      subscription_plan: user.subscriptionPlan,
      trial_ends_at: user.trialEndsAt?.toISOString() ?? null,
      current_period_end: user.currentPeriodEnd?.toISOString() ?? null,
      razorpay_customer_id: user.razorpayCustomerId,
      razorpay_subscription_id: user.razorpaySubscriptionId,
      business_category: settingsMap.business_category ?? null,
      use_cases: settingsMap.use_cases ?? settingsMap.use_case ?? null,
      whatsapp_connected: user.whatsAppAccount?.isConnected ?? false,
      whatsapp_display: user.whatsAppAccount?.displayPhoneNumber ?? null,
      instagram_connected: user.instagramAccount?.isConnected ?? false,
      instagram_username: user.instagramAccount?.username ?? null,
      counts: {
        contacts,
        workflows,
        messages,
        leads,
        career_profiles: careerProfiles,
      },
      billing: this.billing.resolveStatus(user),
      transactions: transactions.map((t) => ({
        id: t.id,
        event_type: t.eventType,
        plan: t.plan,
        amount_inr: t.amountInr,
        status: t.status,
        razorpay_payment_id: t.razorpayPaymentId,
        created_at: t.createdAt.toISOString(),
      })),
    };
  }

  async updateUserAccess(targetUserId: number, dto: UpdateUserAccessDto) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (this.superAdmin.isSuperAdmin(user.email)) {
      return this.getUserDetail(targetUserId);
    }

    const data: {
      subscriptionStatus?: string;
      subscriptionPlan?: string | null;
      trialEndsAt?: Date;
      currentPeriodEnd?: Date | null;
    } = {};

    if (dto.grant_full_access) {
      data.subscriptionStatus = 'active';
      data.subscriptionPlan = 'yearly';
      data.currentPeriodEnd = new Date('2099-12-31T23:59:59.999Z');
    }

    if (dto.extend_trial_days) {
      const ends = new Date();
      ends.setDate(ends.getDate() + dto.extend_trial_days);
      data.subscriptionStatus = 'trial';
      data.trialEndsAt = ends;
      data.currentPeriodEnd = null;
      data.subscriptionPlan = null;
    }

    if (dto.subscription_status) {
      data.subscriptionStatus = dto.subscription_status;
      if (dto.subscription_status === 'cancelled' || dto.subscription_status === 'expired') {
        data.currentPeriodEnd = null;
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: targetUserId }, data });
    }

    return this.getUserDetail(targetUserId);
  }
}
