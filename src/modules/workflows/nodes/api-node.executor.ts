import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { ExternalApiService } from '../../integrations/external-api.service';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class ApiNodeExecutor implements NodeExecutor {
  constructor(private readonly api: ExternalApiService) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const config = node.data ?? {};
    const result = await this.api.execute(config, context, { userId: execution.userId });

    const mapped = result.mapped ?? {};
    const output: Record<string, any> = {
      api_status: result.status ?? null,
      api_data: result.data ?? null,
      ...mapped,
    };

    if (!result.success && config.use_error_branch) {
      return {
        success: true,
        branch: 'error',
        output: {
          ...output,
          api_error: result.error ?? 'API request failed',
        },
      };
    }

    if (!result.success && config.use_fallback) {
      return {
        success: true,
        output: { ...output, fallback: true, api_error: result.error ?? null },
      };
    }

    return {
      success: result.success,
      output,
      stop: !result.success && !config.use_fallback && !config.use_error_branch,
      error: result.success ? null : result.error ?? 'API request failed',
    };
  }
}
