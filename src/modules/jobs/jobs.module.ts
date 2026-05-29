import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InboxModule } from '../inbox/inbox.module';
import { IncomingMessageProcessor } from './incoming-message.processor';
import { QueueWorker } from './queue.worker';

@Module({
  imports: [WorkflowsModule, InboxModule],
  providers: [IncomingMessageProcessor, QueueWorker],
})
export class JobsModule {}
