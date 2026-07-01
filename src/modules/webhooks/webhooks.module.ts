import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { InstagramModule } from '../instagram/instagram.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WebhooksController } from './webhooks.controller';
import { InstagramWebhooksController } from './instagram-webhooks.controller';

@Module({
  imports: [WhatsappModule, InstagramModule, IntegrationsModule, InboxModule, WorkflowsModule],
  controllers: [WebhooksController, InstagramWebhooksController],
})
export class WebhooksModule {}
