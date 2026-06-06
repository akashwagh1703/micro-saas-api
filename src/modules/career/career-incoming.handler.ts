import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CAREER_AI_BUSINESS, CAREER_RATE_LIMIT_DEFAULT } from './career.constants';
import { CareerBotService } from './services/career-bot.service';

/** Routes WhatsApp messages to CareerAI Bot when tenant business type is career_ai. */
@Injectable()
export class CareerIncomingHandler {
  private readonly logger = new Logger(CareerIncomingHandler.name);
  private readonly rateLimitPerMinute: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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
          `(max ${this.rateLimitPerMinute} replies/min)`,
      );
      return true;
    }

    return this.bot.handleIncomingMessage(message);
  }

  /** Throttle when the bot has already sent too many replies to this contact in the last minute. */
  private async isRateLimited(userId: number, contactId: number): Promise<boolean> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const count = await this.prisma.message.count({
      where: {
        userId,
        contactId,
        direction: 'outgoing',
        createdAt: { gte: oneMinuteAgo },
      },
    });
    return count >= this.rateLimitPerMinute;
  }
}
