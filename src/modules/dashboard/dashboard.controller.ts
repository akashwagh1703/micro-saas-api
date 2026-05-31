import { Controller, Get, UseGuards } from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { serializeActivity } from '../../common/serializers';
import { buildVisibleWorkflowsWhere } from '../../common/workflow-scope';
import { SettingsService } from '../settings/settings.service';

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
      activeWorkflows,
      inboxConversations,
      contactsCount,
      leadsCount,
      account,
      instagramAccount,
      aiUsage,
    ] = await this.prisma.$transaction([
      this.prisma.message.count({ where: { userId } }),
      this.prisma.workflow.count({
        where: { ...visibleWhere, isActive: true, status: 'published' },
      }),
      this.prisma.conversation.count({ where: { userId } }),
      this.prisma.contact.count({ where: { userId } }),
      this.prisma.lead.count({ where: { userId } }),
      this.prisma.whatsAppAccount.findUnique({ where: { userId } }),
      this.prisma.instagramAccount.findUnique({ where: { userId } }),
      this.prisma.executionLog.count({ where: { nodeType: 'ai', execution: { userId } } }),
    ]);

    return {
      total_messages: totalMessages,
      active_workflows: activeWorkflows,
      inbox_conversations: inboxConversations,
      contacts_count: contactsCount,
      leads_count: leadsCount,
      whatsapp_connected: !!account?.isConnected,
      whatsapp_display: account?.displayPhoneNumber ?? null,
      instagram_connected: !!instagramAccount?.isConnected,
      instagram_username: instagramAccount?.username ?? null,
      instagram_display: instagramAccount?.displayName ?? null,
      ai_usage: aiUsage,
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
}
