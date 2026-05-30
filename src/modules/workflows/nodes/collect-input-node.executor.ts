import { Inject, Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

/**
 * Ask & Wait node: sends a question on WhatsApp, pauses the workflow until the
 * contact replies, then stores the answer in context under `field` (and in
 * `__collected` for chaining multiple asks).
 */
@Injectable()
export class CollectInputNodeExecutor implements NodeExecutor {
  constructor(@Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const data = node.data ?? {};
    const field = String(data.field ?? node.id).trim();
    const question = String(data.question ?? 'Please reply with your answer.').trim();

    if (!field) {
      return { success: false, error: 'collect_input node requires a field name', stop: true };
    }

    const collected: Record<string, string> = {
      ...((context.__collected as Record<string, string>) ?? {}),
    };

    // Resuming after the contact replied — store their message as the answer.
    if (context.__resuming && context.message != null && !collected[field]) {
      const answer = String(context.message).trim();
      collected[field] = answer;
      return {
        success: true,
        output: {
          __collected: collected,
          [field]: answer,
          __resuming: false,
        },
      };
    }

    // Already answered in a prior step — skip re-asking.
    if (collected[field]) {
      return {
        success: true,
        output: {
          __collected: collected,
          [field]: collected[field],
        },
      };
    }

    if (!execution.conversationId) {
      return { success: false, error: 'No conversation for collect_input', stop: true };
    }

    let message = question;
    for (const [key, value] of Object.entries(context)) {
      if (key.startsWith('__')) {
        continue;
      }
      message = message.split(`{{${key}}}`).join(String(value ?? ''));
    }

    await this.queue.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: message,
    });

    return {
      success: true,
      pause: true,
      stop: true,
      output: {
        __collected: collected,
        __paused_at_node_id: node.id,
        waiting_field: field,
        question_sent: message,
      },
    };
  }
}
