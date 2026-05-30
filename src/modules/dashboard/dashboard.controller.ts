import { Controller, Get, UseGuards } from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { serializeActivity } from '../../common/serializers';
import { visibleWorkflowsWhere } from '../workflows/workflow-templates';

@Controller('dashboard')
@UseGuards(TokenAuthGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async stats(@CurrentUser('id') userId: number) {
    const [
      totalMessages,
      activeWorkflows,
      inboxConversations,
      contactsCount,
      account,
      aiUsage,
    ] = await this.prisma.$transaction([
      this.prisma.message.count({ where: { userId } }),
      this.prisma.workflow.count({
        where: { ...visibleWorkflowsWhere(userId), isActive: true },
      }),
      this.prisma.conversation.count({ where: { userId } }),
      this.prisma.contact.count({ where: { userId } }),
      this.prisma.whatsAppAccount.findUnique({ where: { userId } }),
      this.prisma.executionLog.count({ where: { nodeType: 'ai', execution: { userId } } }),
    ]);

    return {
      total_messages: totalMessages,
      active_workflows: activeWorkflows,
      inbox_conversations: inboxConversations,
      contacts_count: contactsCount,
      whatsapp_connected: !!account?.isConnected,
      whatsapp_display: account?.displayPhoneNumber ?? null,
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
