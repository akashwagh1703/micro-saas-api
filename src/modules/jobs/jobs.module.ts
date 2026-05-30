import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InboxModule } from '../inbox/inbox.module';
import { IncomingMessageProcessor } from './incoming-message.processor';
import { QueueWorker } from './queue.worker';

@Module({
  imports: [SettingsModule, WorkflowsModule, InboxModule],
  providers: [IncomingMessageProcessor, QueueWorker],
})
export class JobsModule {}
