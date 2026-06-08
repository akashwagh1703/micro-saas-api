import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SettingsModule } from '../settings/settings.module';
import { CareerPublicController } from './career-public.controller';
import { CareerController } from './career.controller';
import { CareerBotService } from './services/career-bot.service';
import { CareerIncomingHandler } from './career-incoming.handler';
import { CareerProfileService } from './services/career-profile.service';
import { CareerJobService } from './services/career-job.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';
import { CareerJobRefreshScheduler } from './career-job-refresh.scheduler';
import { CareerMatchingService } from './services/career-matching.service';
import { CareerAiService } from './services/career-ai.service';
import { CareerResumeParserService } from './services/career-resume-parser.service';
import { CareerStorageService } from './services/career-storage.service';
import { CareerApplicationService } from './services/career-application.service';
import { CareerDigestService } from './services/career-digest.service';
import { CareerDigestScheduler } from './career-digest.scheduler';
import { CareerPgBossScheduler } from './career-pgboss.scheduler';
import { CareerAiUsageService } from './services/career-ai-usage.service';
import { CareerAuditService } from './services/career-audit.service';
import { CareerPrivacyService } from './services/career-privacy.service';
import { CareerRetentionScheduler } from './career-retention.scheduler';
import { AdzunaJobSource } from './job-sources/adzuna.job-source';
import { NaukriJobSource } from './job-sources/naukri.job-source';
import { LinkedInJobSource } from './job-sources/linkedin.job-source';
import { CareerJobSourceRegistry } from './job-sources/career-job-source.registry';
import { CareerJobUpsertService } from './job-sources/career-job-upsert.service';
import { CareerDocumentShareService } from './services/career-document-share.service';
import { CareerDocxService } from './services/career-docx.service';

@Module({
  imports: [IntegrationsModule, InboxModule, WhatsappModule, SettingsModule],
  controllers: [CareerController, CareerPublicController],
  providers: [
    CareerBotService,
    CareerIncomingHandler,
    CareerProfileService,
    CareerJobService,
    CareerJobFetcherService,
    CareerJobRefreshScheduler,
    CareerMatchingService,
    CareerAiService,
    CareerResumeParserService,
    CareerStorageService,
    CareerApplicationService,
    CareerDigestService,
    CareerDigestScheduler,
    CareerPgBossScheduler,
    CareerAiUsageService,
    CareerAuditService,
    CareerPrivacyService,
    CareerRetentionScheduler,
    CareerJobUpsertService,
    AdzunaJobSource,
    NaukriJobSource,
    LinkedInJobSource,
    CareerJobSourceRegistry,
    CareerDocumentShareService,
    CareerDocxService,
  ],
  exports: [CareerIncomingHandler, CareerDigestService, CareerBotService],
})
export class CareerModule {}
