import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import {
  QUEUE_CAREER_DIGEST,
  QUEUE_CAREER_JOB_REFRESH,
  QUEUE_CAREER_TASK,
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_PROCESS_INCOMING,
  QUEUE_SEND_MESSAGE,
  SendMessageJob,
  CareerTaskJob,
} from '../queue/queue.constants';
import { IncomingMessageProcessor } from './incoming-message.processor';
import { CareerTaskProcessor } from './career-task.processor';
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
    private readonly careerTasks: CareerTaskProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') !== 'pgboss') {
      this.logger.log('QUEUE_DRIVER != pgboss; queue workers not registered (inline mode).');
      return;
    }

    await this.queue.waitUntilReady();
    if (!this.queue.isBossRunning()) {
      this.logger.warn('pg-boss unavailable; queue workers not registered');
      return;
    }

    await this.queue.work<{ messageId: number }>(QUEUE_PROCESS_INCOMING, async (data) => {
      try {
        await this.incoming.handle(data.messageId);
      } catch (e: any) {
        this.logger.error(`process-incoming failed for message ${data.messageId}: ${e.message}`);
        throw e;
      }
    });

    await this.queue.work<{ executionId: number }>(QUEUE_EXECUTE_WORKFLOW, async (data) => {
      try {
        await this.execution.executeById(data.executionId);
      } catch (e: any) {
        this.logger.error(`execute-workflow failed for execution ${data.executionId}: ${e.message}`);
        throw e;
      }
    });

    await this.queue.work<SendMessageJob>(QUEUE_SEND_MESSAGE, async (data) => {
      if (data.conversationId == null) {
        return;
      }
      try {
        await this.inbox.sendOutgoingMessage(data.userId, data.conversationId, data.content);
      } catch (e: any) {
        this.logger.error(
          `send-message failed for conversation ${data.conversationId}: ${e.message}`,
        );
        throw e;
      }
    });

    await this.queue.work<CareerTaskJob>(QUEUE_CAREER_TASK, async (data) => {
      await this.careerTasks.handle(data);
    });

    this.logger.log('Queue workers registered.');
  }
}
