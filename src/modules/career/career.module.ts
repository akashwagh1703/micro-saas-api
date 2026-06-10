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
import { CareerProfileKeywordsService } from './services/career-profile-keywords.service';
import { CareerJobService } from './services/career-job.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';
import { CareerJobRefreshScheduler } from './career-job-refresh.scheduler';
import { CareerMatchingService } from './services/career-matching.service';
import { CareerAiService } from './services/career-ai.service';
import { CareerResumeParserService } from './services/career-resume-parser.service';
import { CareerStorageService } from './services/career-storage.service';
import { CareerApplicationService } from './services/career-application.service';
import { CareerDigestService } from './services/career-digest.service';
import { CareerJobAlertService } from './services/career-job-alert.service';
import { CareerInterviewService } from './services/career-interview.service';
import { CareerGuidanceService } from './services/career-guidance.service';
import { CareerEmailService } from './services/career-email.service';
import { CareerAlertChannelService } from './services/career-alert-channel.service';
import { CareerPortalShareService } from './services/career-portal-share.service';
import { CareerPortalService } from './services/career-portal.service';
import { CareerSeekerBillingService } from './services/career-seeker-billing.service';
import { CareerTenantSettingsService } from './services/career-tenant-settings.service';
import { CareerDigestScheduler } from './career-digest.scheduler';
import { CareerPgBossScheduler } from './career-pgboss.scheduler';
import { CareerAiUsageService } from './services/career-ai-usage.service';
import { CareerAuditService } from './services/career-audit.service';
import { CareerPrivacyService } from './services/career-privacy.service';
import { CareerRetentionScheduler } from './career-retention.scheduler';
import { AdzunaJobSource } from './job-sources/adzuna.job-source';
import { JSearchJobSource } from './job-sources/jsearch.job-source';
import { NaukriJobSource } from './job-sources/naukri.job-source';
import { LinkedInJobSource } from './job-sources/linkedin.job-source';
import { CareerJobSourceRegistry } from './job-sources/career-job-source.registry';
import { CareerJobUpsertService } from './job-sources/career-job-upsert.service';
import { CareerDocumentShareService } from './services/career-document-share.service';
import { CareerDocxService } from './services/career-docx.service';
import { CareerPdfService } from './services/career-pdf.service';
import { CareerResumeBuilderService } from './services/career-resume-builder.service';

@Module({
  imports: [IntegrationsModule, InboxModule, WhatsappModule, SettingsModule],
  controllers: [CareerController, CareerPublicController],
  providers: [
    CareerBotService,
    CareerIncomingHandler,
    CareerProfileService,
    CareerJobService,
    CareerProfileKeywordsService,
    CareerJobFetcherService,
    CareerJobRefreshScheduler,
    CareerMatchingService,
    CareerAiService,
    CareerResumeParserService,
    CareerStorageService,
    CareerApplicationService,
    CareerDigestService,
    CareerJobAlertService,
    CareerInterviewService,
    CareerGuidanceService,
    CareerEmailService,
    CareerAlertChannelService,
    CareerPortalShareService,
    CareerPortalService,
    CareerSeekerBillingService,
    CareerTenantSettingsService,
    CareerDigestScheduler,
    CareerPgBossScheduler,
    CareerAiUsageService,
    CareerAuditService,
    CareerPrivacyService,
    CareerRetentionScheduler,
    CareerJobUpsertService,
    AdzunaJobSource,
    JSearchJobSource,
    NaukriJobSource,
    LinkedInJobSource,
    CareerJobSourceRegistry,
    CareerDocumentShareService,
    CareerDocxService,
    CareerPdfService,
    CareerResumeBuilderService,
  ],
  exports: [
    CareerIncomingHandler,
    CareerDigestService,
    CareerJobAlertService,
    CareerBotService,
    CareerSeekerBillingService,
  ],
})
export class CareerModule {}
