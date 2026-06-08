import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JobDispatcher } from './job-dispatcher';
import { CareerTaskJob, SendMessageJob } from './queue.constants';

/**
 * Serverless-friendly dispatcher: instead of enqueueing, it runs each job inline
 * and awaits it, so a single stateless function invocation (e.g. a WhatsApp
 * webhook) fully processes the message before responding.
 *
 * Services are resolved lazily via ModuleRef + dynamic import to avoid module
 * import cycles (queue <-> jobs/workflows/inbox).
 */
export class SyncDispatcher implements JobDispatcher {
  private readonly logger = new Logger(SyncDispatcher.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async enqueueProcessIncoming(messageId: number): Promise<void> {
    const { IncomingMessageProcessor } = await import('../jobs/incoming-message.processor');
    const processor = this.moduleRef.get(IncomingMessageProcessor, { strict: false });
    await processor.handle(messageId);
  }

  async enqueueExecuteWorkflow(executionId: number): Promise<void> {
    const { WorkflowExecutionService } = await import('../workflows/workflow-execution.service');
    const service = this.moduleRef.get(WorkflowExecutionService, { strict: false });
    await service.executeById(executionId);
  }

  async enqueueSendMessage(payload: SendMessageJob): Promise<void> {
    if (payload.conversationId == null) {
      return;
    }
    const { InboxService } = await import('../inbox/inbox.service');
    const inbox = this.moduleRef.get(InboxService, { strict: false });
    await inbox.sendOutgoingMessage(payload.userId, payload.conversationId, payload.content);
  }

  async enqueueCareerTask(payload: CareerTaskJob): Promise<void> {
    const { CareerTaskProcessor } = await import('../jobs/career-task.processor');
    const processor = this.moduleRef.get(CareerTaskProcessor, { strict: false });
    await processor.handle(payload);
  }
}
