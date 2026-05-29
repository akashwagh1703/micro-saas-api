import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class ConditionNodeExecutor implements NodeExecutor {
  async execute(
    _execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const data = node.data ?? {};
    const field = data.field ?? 'message';
    const operator = data.operator ?? 'contains';
    const value = data.value ?? '';

    const actual = String(context[field] ?? context.message ?? '');

    let matched: boolean;
    switch (operator) {
      case 'equals':
        matched = actual === value;
        break;
      case 'starts_with':
        matched = actual.startsWith(value);
        break;
      case 'ends_with':
        matched = actual.endsWith(value);
        break;
      default:
        matched = actual.toLowerCase().includes(String(value).toLowerCase());
    }

    return {
      success: true,
      output: { matched },
      branch: matched ? 'true' : 'false',
    };
  }
}
