import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import {
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_PROCESS_INCOMING,
  QUEUE_SEND_MESSAGE,
  SendMessageJob,
} from '../queue/queue.constants';
import { IncomingMessageProcessor } from './incoming-message.processor';
import { WorkflowExecutionService } from '../workflows/workflow-execution.service';
import { InboxService } from '../inbox/inbox.service';

/** Registers handlers for all three job queues, running in this same process. */
@Injectable()
export class QueueWorker implements OnModuleInit {
  private readonly logger = new Logger(QueueWorker.name);

  constructor(
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly incoming: IncomingMessageProcessor,
    private readonly execution: WorkflowExecutionService,
    private readonly inbox: InboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') !== 'pgboss') {
      this.logger.log('QUEUE_DRIVER != pgboss; queue workers not registered (inline mode).');
      return;
    }

    await this.queue.work<{ messageId: number }>(QUEUE_PROCESS_INCOMING, async (data) => {
      await this.incoming.handle(data.messageId);
    });

    await this.queue.work<{ executionId: number }>(QUEUE_EXECUTE_WORKFLOW, async (data) => {
      await this.execution.executeById(data.executionId);
    });

    await this.queue.work<SendMessageJob>(QUEUE_SEND_MESSAGE, async (data) => {
      if (data.conversationId == null) {
        return;
      }
      await this.inbox.sendOutgoingMessage(data.userId, data.conversationId, data.content);
    });

    this.logger.log('Queue workers registered.');
  }
}
