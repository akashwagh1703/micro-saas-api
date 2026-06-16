import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class DelayNodeExecutor implements NodeExecutor {
  async execute(
    _execution: WorkflowExecution,
    node: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const raw = parseInt(String(node.data?.seconds ?? node.data?.delay_seconds ?? 5), 10);
    const seconds = Math.min(Math.max(Number.isFinite(raw) ? raw : 5, 1), 3600);

    return {
      success: true,
      output: { delay_seconds: seconds },
    };
  }
}
