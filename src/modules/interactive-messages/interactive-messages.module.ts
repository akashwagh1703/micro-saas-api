import { Module } from '@nestjs/common';
import { InteractiveMessagesService } from './interactive-messages.service';
import { InteractiveMessagesController } from './interactive-messages.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, QueueModule, WorkflowsModule, WhatsappModule],
  controllers: [InteractiveMessagesController],
  providers: [InteractiveMessagesService],
  exports: [InteractiveMessagesService],
})
export class InteractiveMessagesModule {}
