import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { SuperAdminService } from '../../common/super-admin.service';
import { UpdateUserAccessDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  async getOverview() {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [totalUsers, newThisWeek, activeSubscriptions, onTrial, expiredOrCancelled] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.user.count({ where: { subscriptionStatus: 'active' } }),
        this.prisma.user.count({ where: { subscriptionStatus: 'trial' } }),
        this.prisma.user.count({
          where: { subscriptionStatus: { in: ['expired', 'cancelled'] } },
        }),
      ]);

    return {
      total_users: totalUsers,
      new_this_week: newThisWeek,
      active_subscriptions: activeSubscriptions,
      on_trial: onTrial,
      expired_or_cancelled: expiredOrCancelled,
    };
  }

  async listUsers(page = 1, search = '') {
    const perPage = 20;
    const skip = (Math.max(1, page) - 1) * perPage;
    const term = search.trim();

    const where = term
      ? {
          OR: [
            { email: { contains: term, mode: 'insensitive' as const } },
            { name: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {};

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

    const [contacts, workflows, messages, leads, careerProfiles, settings] = await Promise.all([
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
