import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { getByPath } from '../../../common/template-variables.util';
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

    const actualRaw = getByPath(context, field) ?? context[field] ?? context.message ?? '';
    const actual = String(actualRaw ?? '');
    const compare = String(value ?? '');

    let matched: boolean;
    switch (operator) {
      case 'equals':
        matched = actual === compare;
        break;
      case 'not_equals':
        matched = actual !== compare;
        break;
      case 'starts_with':
        matched = actual.startsWith(compare);
        break;
      case 'ends_with':
        matched = actual.endsWith(compare);
        break;
      case 'not_empty':
        matched = actual.trim().length > 0;
        break;
      case 'greater_than':
        matched = Number(actual) > Number(compare);
        break;
      case 'less_than':
        matched = Number(actual) < Number(compare);
        break;
      case 'regex':
        try {
          matched = new RegExp(compare, 'i').test(actual);
        } catch {
          matched = false;
        }
        break;
      default:
        matched = actual.toLowerCase().includes(compare.toLowerCase());
    }

    return {
      success: true,
      output: { matched, condition_field: field, condition_value: compare },
      branch: matched ? 'true' : 'false',
    };
  }
}
