import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CHANNEL_INSTAGRAM, CHANNEL_WHATSAPP } from '../../common/channels';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { serializeActivity } from '../../common/serializers';
import { buildVisibleWorkflowsWhere } from '../../common/workflow-scope';
import { SettingsService } from '../settings/settings.service';
import { buildChannelAnalytics, resolveAnalyticsDays } from './dashboard-analytics';
import { computeBookingDashboardStats } from './dashboard-booking-stats';
import { computeCatalogDashboardStats } from './dashboard-catalog-stats';

@Controller('dashboard')
@UseGuards(TokenAuthGuard)
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('stats')
  async stats(@CurrentUser('id') userId: number) {
    const visibleWhere = await buildVisibleWorkflowsWhere(userId, this.settings);

    const [
      totalMessages,
      whatsappMessages,
      instagramMessages,
      activeWorkflows,
      inboxConversations,
      whatsappConversations,
      instagramConversations,
      contactsCount,
      leadsCount,
      whatsappLeads,
      instagramLeads,
      account,
      instagramAccount,
      aiUsage,
    ] = await this.prisma.$transaction([
      this.prisma.message.count({ where: { userId } }),
      this.prisma.message.count({ where: { userId, channel: CHANNEL_WHATSAPP } }),
      this.prisma.message.count({ where: { userId, channel: CHANNEL_INSTAGRAM } }),
      this.prisma.workflow.count({
        where: { ...visibleWhere, isActive: true, status: 'published' },
      }),
      this.prisma.conversation.count({ where: { userId } }),
      this.prisma.conversation.count({ where: { userId, channel: CHANNEL_WHATSAPP } }),
      this.prisma.conversation.count({ where: { userId, channel: CHANNEL_INSTAGRAM } }),
      this.prisma.contact.count({ where: { userId } }),
      this.prisma.lead.count({ where: { userId } }),
      this.prisma.lead.count({ where: { userId, channel: CHANNEL_WHATSAPP } }),
      this.prisma.lead.count({ where: { userId, channel: CHANNEL_INSTAGRAM } }),
      this.prisma.whatsAppAccount.findUnique({ where: { userId } }),
      this.prisma.instagramAccount.findUnique({ where: { userId } }),
      this.prisma.executionLog.count({ where: { nodeType: 'ai', execution: { userId } } }),
    ]);

    const bookingStats = await computeBookingDashboardStats(this.prisma, this.settings, userId);
    const catalogStats = await computeCatalogDashboardStats(this.prisma, userId);

    return {
      total_messages: totalMessages,
      whatsapp_messages: whatsappMessages,
      instagram_messages: instagramMessages,
      active_workflows: activeWorkflows,
      inbox_conversations: inboxConversations,
      whatsapp_conversations: whatsappConversations,
      instagram_conversations: instagramConversations,
      contacts_count: contactsCount,
      leads_count: leadsCount,
      whatsapp_leads: whatsappLeads,
      instagram_leads: instagramLeads,
      whatsapp_connected: !!account?.isConnected,
      whatsapp_display: account?.displayPhoneNumber ?? null,
      instagram_connected: !!instagramAccount?.isConnected,
      instagram_username: instagramAccount?.username ?? null,
      instagram_display: instagramAccount?.displayName ?? null,
      ai_usage: aiUsage,
      ...bookingStats,
      ...catalogStats,
    };
  }

  @Get('activity')
  async recentActivity(@CurrentUser('id') userId: number) {
    const activities = await this.prisma.activity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return { activities: activities.map(serializeActivity) };
  }

  /** Per-channel message and lead trends (Phase 8 analytics). */
  @Get('analytics')
  async analytics(@CurrentUser('id') userId: number, @Query('days') daysRaw?: string) {
    const days = resolveAnalyticsDays(daysRaw);
    return buildChannelAnalytics(this.prisma, userId, days);
  }

  /** Recent delivery failures and integration errors (Phase 7 hardening). */
  @Get('integration-health')
  async integrationHealth(@CurrentUser('id') userId: number) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [failedOutbound, whatsappFailed, instagramFailed, recentErrors] =
      await this.prisma.$transaction([
        this.prisma.message.count({
          where: {
            userId,
            direction: 'outgoing',
            status: 'failed',
            createdAt: { gte: weekAgo },
          },
        }),
        this.prisma.message.count({
          where: {
            userId,
            channel: CHANNEL_WHATSAPP,
            direction: 'outgoing',
            status: 'failed',
            createdAt: { gte: weekAgo },
          },
        }),
        this.prisma.message.count({
          where: {
            userId,
            channel: CHANNEL_INSTAGRAM,
            direction: 'outgoing',
            status: 'failed',
            createdAt: { gte: weekAgo },
          },
        }),
        this.prisma.activity.findMany({
          where: { userId, type: 'integration_error' },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

    return {
      failed_outbound_7d: failedOutbound,
      whatsapp_failed_7d: whatsappFailed,
      instagram_failed_7d: instagramFailed,
      recent_errors: recentErrors.map(serializeActivity),
      healthy: failedOutbound === 0,
    };
  }
}
