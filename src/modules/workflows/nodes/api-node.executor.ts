import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { ExternalApiService } from '../../integrations/external-api.service';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class ApiNodeExecutor implements NodeExecutor {
  constructor(private readonly api: ExternalApiService) {}

  async execute(
    _execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const config = node.data ?? {};
    const result = await this.api.execute(config, context);

    if (!result.success && config.use_fallback) {
      return {
        success: true,
        output: { fallback: true, error: result.error ?? null },
      };
    }

    return {
      success: result.success,
      output: result as Record<string, any>,
      stop: !result.success && !config.use_fallback,
    };
  }
}
