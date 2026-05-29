import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [WhatsappModule, IntegrationsModule, InboxModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
