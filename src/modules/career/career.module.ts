import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SettingsModule } from '../settings/settings.module';
import { CareerController } from './career.controller';
import { CareerBotService } from './services/career-bot.service';
import { CareerIncomingHandler } from './career-incoming.handler';
import { CareerProfileService } from './services/career-profile.service';
import { CareerJobService } from './services/career-job.service';
import { CareerMatchingService } from './services/career-matching.service';
import { CareerAiService } from './services/career-ai.service';
import { CareerResumeParserService } from './services/career-resume-parser.service';
import { CareerStorageService } from './services/career-storage.service';
import { CareerApplicationService } from './services/career-application.service';
import { CareerDigestService } from './services/career-digest.service';
import { CareerDigestScheduler } from './career-digest.scheduler';

@Module({
  imports: [IntegrationsModule, InboxModule, WhatsappModule, SettingsModule],
  controllers: [CareerController],
  providers: [
    CareerBotService,
    CareerIncomingHandler,
    CareerProfileService,
    CareerJobService,
    CareerMatchingService,
    CareerAiService,
    CareerResumeParserService,
    CareerStorageService,
    CareerApplicationService,
    CareerDigestService,
    CareerDigestScheduler,
  ],
  exports: [CareerIncomingHandler, CareerDigestService, CareerBotService],
})
export class CareerModule {}
