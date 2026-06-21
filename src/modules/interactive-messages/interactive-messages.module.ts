import { Module } from '@nestjs/common';
import { InteractiveMessagesService } from './interactive-messages.service';
import { InteractiveMessagesController } from './interactive-messages.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WhatsAppApiService } from './services/whatsapp-api.service';
import { MessageQueueService } from './services/message-queue.service';
import { WebhookHandlerService } from './services/webhook-handler.service';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    WorkflowsModule,
    WhatsappModule,
  ],
  controllers: [InteractiveMessagesController],
  providers: [
    InteractiveMessagesService,
    WhatsAppApiService,
    MessageQueueService,
    WebhookHandlerService,
  ],
  exports: [
    InteractiveMessagesService,
    WebhookHandlerService,
  ],
})
export class InteractiveMessagesModule {}
