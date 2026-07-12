import { Inject, Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { substituteContext } from './booking-node.helpers';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class SendMessageNodeExecutor implements NodeExecutor {
  constructor(@Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const data = node.data ?? {};
    const message = substituteContext(String(data.message ?? ''), context);
    const fallbackMessage = substituteContext(String(data.fallback_message ?? ''), context);

    await this.queue.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: message.trim() || fallbackMessage || 'Thanks for your message!',
    });

    return {
      success: true,
      output: { queued: true, message },
    };
  }
}
