import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class TriggerNodeExecutor implements NodeExecutor {
  async execute(
    _execution: WorkflowExecution,
    _node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    return {
      success: true,
      output: {
        trigger: context.trigger ?? 'message',
        message: context.message ?? '',
        channel: context.channel ?? 'whatsapp',
        contact_phone: context.contact_phone ?? '',
        contact_name: context.contact_name ?? '',
        contact_username: context.contact_username ?? '',
        payload: context.payload ?? null,
      },
    };
  }
}
