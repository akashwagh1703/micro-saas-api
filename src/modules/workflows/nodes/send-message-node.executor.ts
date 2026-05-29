import { Inject, Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
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
    let message = String(data.message ?? '');

    for (const [key, value] of Object.entries(context)) {
      message = message.split(`{{${key}}}`).join(String(value ?? ''));
    }

    await this.queue.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: message,
    });

    return {
      success: true,
      output: { queued: true, message },
    };
  }
}
