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
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogWebsiteOrderHandler } from './catalog-website-order.handler';
import { CatalogShippingAddressHandler } from './catalog-shipping-address.handler';
import { QueueWorker } from './queue.worker';

@Module({
  imports: [
    SettingsModule,
    BillingModule,
    WorkflowsModule,
    InboxModule,
    CareerModule,
    IntegrationsModule,
    CatalogModule,
  ],
  providers: [
    IncomingMessageProcessor,
    InteractiveMessageProcessor,
    CareerTaskProcessor,
    CatalogWebsiteOrderHandler,
    CatalogShippingAddressHandler,
    QueueWorker,
  ],
})
export class JobsModule {}
