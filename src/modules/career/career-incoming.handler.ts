import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { InboxService } from '../inbox/inbox.service';
import {
  CAREER_AI_BUSINESS,
  CAREER_BOT_MESSAGE_SOURCE,
  CAREER_RATE_LIMIT_DEFAULT,
} from './career.constants';
import { CareerBotService } from './services/career-bot.service';

/** Routes WhatsApp messages to CareerAI Bot when tenant business type is career_ai. */
@Injectable()
export class CareerIncomingHandler {
  private readonly logger = new Logger(CareerIncomingHandler.name);
  private readonly rateLimitPerMinute: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly bot: CareerBotService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('CAREER_RATE_LIMIT_PER_MINUTE');
    const parsed = parseInt(raw ?? String(CAREER_RATE_LIMIT_DEFAULT), 10);
    this.rateLimitPerMinute =
      Number.isNaN(parsed) || parsed < 1 ? CAREER_RATE_LIMIT_DEFAULT : parsed;
  }

  async tryHandle(messageId: number): Promise<boolean> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });

    if (!message || message.direction !== 'incoming' || message.contact.channel !== 'whatsapp') {
      return false;
    }

    const businessCategory = await this.settings.get(message.userId, 'business_category');
    if (businessCategory !== CAREER_AI_BUSINESS) {
      return false;
    }

    if (await this.isRateLimited(message.userId, message.contactId)) {
      this.logger.warn(
        `Rate limit hit for tenant=${message.userId} contact=${message.contactId} ` +
          `(max ${this.rateLimitPerMinute} bot replies/min)`,
      );
      await this.sendRateLimitNotice(message.userId, message.contactId);
      return true;
    }

    return this.bot.handleIncomingMessage(message);
  }

  /** Count only CareerAI bot replies — not human agent messages from the inbox. */
  private async isRateLimited(userId: number, contactId: number): Promise<boolean> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const count = await this.prisma.message.count({
      where: {
        userId,
        contactId,
        direction: 'outgoing',
        createdAt: { gte: oneMinuteAgo },
        metadata: {
          path: ['source'],
          equals: CAREER_BOT_MESSAGE_SOURCE,
        },
      },
    });
    return count >= this.rateLimitPerMinute;
  }

  private async sendRateLimitNotice(userId: number, contactId: number): Promise<void> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentNotice = await this.prisma.message.count({
      where: {
        userId,
        contactId,
        direction: 'outgoing',
        createdAt: { gte: oneMinuteAgo },
        content: { contains: 'Please wait a moment' },
      },
    });
    if (recentNotice > 0) {
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId },
    });
    if (!conversation) {
      return;
    }

    await this.inbox.sendOutgoingMessage(
      userId,
      conversation.id,
      'Please wait a moment before sending more messages. ⏳',
      { source: CAREER_BOT_MESSAGE_SOURCE },
    );
  }
}
