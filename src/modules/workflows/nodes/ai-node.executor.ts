import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { AiService } from '../../integrations/ai.service';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class AiNodeExecutor implements NodeExecutor {
  constructor(private readonly ai: AiService) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const config = node.data ?? {};
    const result = await this.ai.generate(execution.userId, config, context);

    if (!result.success) {
      const fallback = result.fallback ?? config.fallback_message ?? null;
      if (fallback) {
        return { success: true, output: { ai_response: fallback, fallback: true } };
      }
      return { success: false, output: result as Record<string, any>, stop: true };
    }

    return {
      success: true,
      output: { ai_response: result.content, usage: result.usage ?? null },
    };
  }
}
