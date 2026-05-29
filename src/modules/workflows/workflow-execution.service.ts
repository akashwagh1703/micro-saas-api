import { Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowValidator } from './workflow-validator.service';
import { NodeExecutor } from './nodes/node-executor.interface';
import { TriggerNodeExecutor } from './nodes/trigger-node.executor';
import { ConditionNodeExecutor } from './nodes/condition-node.executor';
import { ApiNodeExecutor } from './nodes/api-node.executor';
import { AiNodeExecutor } from './nodes/ai-node.executor';
import { SendMessageNodeExecutor } from './nodes/send-message-node.executor';

const MAX_NODES = 20;

interface Edge {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
}

/** Walks a workflow's node graph and runs each node (ported from WorkflowExecutionService). */
@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name);
  private readonly executors: Record<string, NodeExecutor>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: WorkflowValidator,
    trigger: TriggerNodeExecutor,
    condition: ConditionNodeExecutor,
    api: ApiNodeExecutor,
    ai: AiNodeExecutor,
    sendMessage: SendMessageNodeExecutor,
  ) {
    this.executors = {
      trigger,
      condition,
      api,
      ai,
      send_message: sendMessage,
    };
  }

  async executeById(executionId: number): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({ where: { id: executionId } });
    if (!execution) {
      return;
    }
    await this.execute(execution);
  }

  async execute(execution: WorkflowExecution): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: execution.workflowId, userId: execution.userId },
    });

    if (!workflow) {
      await this.fail(execution.id, 'Workflow not found');
      return;
    }

    if (workflow.status !== 'published' || !workflow.isActive) {
      await this.fail(execution.id, 'Workflow not active');
      return;
    }

    const definition = (workflow.definition ?? {}) as { nodes?: any[]; edges?: Edge[] };
    const errors = this.validator.validate(definition);
    if (errors.length > 0) {
      await this.fail(execution.id, errors.join(', '));
      return;
    }

    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: 'running', startedAt: new Date() },
    });

    let context: Record<string, any> = (execution.context as Record<string, any>) ?? {};

    const nodes = definition.nodes ?? [];
    const edges = definition.edges ?? [];
    const nodesById = new Map<string, any>(nodes.map((n) => [n.id, n]));
    const trigger = nodes.find((n) => n.type === 'trigger');

    if (!trigger) {
      await this.fail(execution.id, 'No trigger node');
      return;
    }

    let currentId: string | null = trigger.id;
    const visited: Record<string, boolean> = {};
    let steps = 0;

    try {
      while (currentId !== null && !visited[currentId]) {
        if (++steps > MAX_NODES) {
          await this.fail(execution.id, 'Too many nodes');
          return;
        }

        visited[currentId] = true;
        const node = nodesById.get(currentId);
        if (!node) {
          break;
        }

        const executor = this.executors[node.type];
        if (!executor) {
          currentId = this.resolveNextNodeId(edges, node, null);
          continue;
        }

        const start = Date.now();
        const log = await this.prisma.executionLog.create({
          data: {
            workflowExecutionId: execution.id,
            nodeId: node.id,
            nodeType: node.type,
            status: 'running',
            input: context as any,
          },
        });

        const result = await executor.execute(execution, node, context);
        context = { ...context, ...(result.output ?? {}) };

        await this.prisma.executionLog.update({
          where: { id: log.id },
          data: {
            status: result.success ? 'completed' : 'failed',
            output: (result.output ?? null) as any,
            errorMessage: result.error ?? null,
            durationMs: Date.now() - start,
          },
        });

        if (result.stop) {
          break;
        }

        currentId = this.resolveNextNodeId(edges, node, result);
      }

      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'completed', context: context as any, completedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.error(`Workflow execution failed (id=${execution.id}): ${e.message}`);
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'failed', errorMessage: e.message, completedAt: new Date() },
      });
    }
  }

  private resolveNextNodeId(
    edges: Edge[],
    node: Record<string, any>,
    result: { branch?: string; output?: Record<string, any> } | null,
  ): string | null {
    const outgoing = edges.filter((e) => e.source === node.id);

    if (outgoing.length === 0) {
      return null;
    }

    if (node.type === 'condition' && result !== null) {
      const branch = result.branch ?? (result.output?.matched ? 'true' : 'false');
      const branchEdge = outgoing.find((e) => (e.sourceHandle ?? null) === branch);

      if (branchEdge) {
        return branchEdge.target ?? null;
      }
      if (branch === 'true') {
        const unlabeled = outgoing.find((e) => !e.sourceHandle);
        return unlabeled?.target ?? null;
      }
      return null;
    }

    return outgoing[0].target ?? null;
  }

  private async fail(executionId: number, message: string): Promise<void> {
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'failed', errorMessage: message },
    });
  }
}
