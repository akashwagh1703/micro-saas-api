import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CAREER_AI_BUSINESS } from './career.constants';
import { CareerBotService } from './services/career-bot.service';

/** Routes WhatsApp messages to CareerAI Bot when tenant business type is career_ai. */
@Injectable()
export class CareerIncomingHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly bot: CareerBotService,
  ) {}

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

    return this.bot.handleIncomingMessage(message);
  }
}
