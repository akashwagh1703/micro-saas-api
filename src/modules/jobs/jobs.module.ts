import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BillingModule } from '../billing/billing.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InboxModule } from '../inbox/inbox.module';
import { CareerModule } from '../career/career.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { IncomingMessageProcessor } from './incoming-message.processor';
import { InteractiveMessageProcessor } from './interactive-message.processor';
import { CareerTaskProcessor } from './career-task.processor';
import { CatalogWebsiteOrderHandler } from './catalog-website-order.handler';
import { QueueWorker } from './queue.worker';

@Module({
  imports: [SettingsModule, BillingModule, WorkflowsModule, InboxModule, CareerModule, IntegrationsModule],
  providers: [
    IncomingMessageProcessor,
    InteractiveMessageProcessor,
    CareerTaskProcessor,
    CatalogWebsiteOrderHandler,
    QueueWorker,
  ],
})
export class JobsModule {}
