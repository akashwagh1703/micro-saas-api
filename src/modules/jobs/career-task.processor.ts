import { Injectable, Logger } from '@nestjs/common';
import { CareerTaskJob } from '../queue/queue.constants';
import { CareerBotService } from '../career/services/career-bot.service';

/** Runs heavy CareerAI work off the WhatsApp message path (parse, generate). */
@Injectable()
export class CareerTaskProcessor {
  private readonly logger = new Logger(CareerTaskProcessor.name);

  constructor(private readonly bot: CareerBotService) {}

  async handle(data: CareerTaskJob): Promise<void> {
    try {
      switch (data.type) {
        case 'parse_resume':
          await this.bot.runParseResumeTask(data.messageId, !!data.reupload);
          break;
        case 'generate_resume':
          await this.bot.runGenerateResumeTask(data.messageId, data.profileId, data.jobIndex);
          break;
        case 'generate_cover_letter':
          await this.bot.runGenerateCoverLetterTask(data.messageId, data.profileId);
          break;
        default:
          this.logger.warn(`Unknown career task type: ${(data as CareerTaskJob).type}`);
      }
    } catch (e: any) {
      this.logger.error(`Career task ${data.type} failed messageId=${data.messageId}: ${e.message}`);
      throw e;
    }
  }
}
