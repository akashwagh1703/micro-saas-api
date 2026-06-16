import { WorkflowExecution } from '@prisma/client';

export interface NodeExecutionResult {
  success: boolean;
  output?: Record<string, any>;
  error?: string | null;
  stop?: boolean;
  /** When true, execution pauses until the contact replies (Ask & Wait). */
  pause?: boolean;
  branch?: 'true' | 'false' | 'error';
}

export interface NodeExecutor {
  execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult>;
}
