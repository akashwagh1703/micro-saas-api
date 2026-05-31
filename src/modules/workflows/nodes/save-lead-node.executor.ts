import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';

/** Persists a lead from workflow context (collected answers + contact info). */
@Injectable()
export class SaveLeadNodeExecutor implements NodeExecutor {
  constructor(private readonly leads: LeadsService) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const notes = typeof node.data?.notes === 'string' ? node.data.notes.trim() : '';

    try {
      const lead = await this.leads.createFromExecution({
        execution,
        context,
        notes: notes || undefined,
      });

      return {
        success: true,
        output: {
          lead_id: lead.id,
          lead_status: lead.status,
        },
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message ?? 'Failed to save lead',
      };
    }
  }
}
