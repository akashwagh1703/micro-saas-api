import { Injectable, Logger, Inject } from '@nestjs/common';
import { parseExpression } from 'cron-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { QueueService } from '../queue/queue.service';
import { QUEUE_WORKFLOW_SCHEDULE_TICK } from '../queue/queue.constants';

@Injectable()
export class WorkflowScheduleService {
  private readonly logger = new Logger(WorkflowScheduleService.name);
  private tickRegistered = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async ensureGlobalTick(): Promise<void> {
    if (this.tickRegistered || !this.queueService.isBossRunning()) {
      return;
    }

    try {
      await this.queueService.scheduleCron(QUEUE_WORKFLOW_SCHEDULE_TICK, '*/1 * * * *', {}, { tz: 'UTC' });
      this.tickRegistered = true;
      this.logger.log('Workflow schedule tick registered (every minute, UTC)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not register workflow schedule tick: ${message}`);
    }
  }

  async processTick(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        triggerType: 'schedule',
        status: 'published',
        isActive: true,
        isArchived: false,
        scheduleCron: { not: null },
      },
    });

    const now = new Date();
    for (const workflow of workflows) {
      if (!workflow.scheduleCron) continue;
      if (!(await this.shouldRunNow(workflow.id, workflow.scheduleCron, workflow.scheduleTimezone ?? 'UTC', now))) {
        continue;
      }
      await this.runScheduledWorkflow(workflow.id, workflow.userId);
    }
  }

  private async shouldRunNow(
    workflowId: number,
    cron: string,
    timezone: string,
    now: Date,
  ): Promise<boolean> {
    try {
      const interval = parseExpression(cron, { tz: timezone, currentDate: now });
      const prev = interval.prev().toDate();
      const diffMs = now.getTime() - prev.getTime();
      if (diffMs < 0 || diffMs > 90_000) {
        return false;
      }

      const recent = await this.prisma.workflowExecution.findFirst({
        where: {
          workflowId,
          createdAt: { gte: new Date(now.getTime() - 55_000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      return !recent;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Invalid cron for workflow ${workflowId}: ${message}`);
      return false;
    }
  }

  async runScheduledWorkflow(workflowId: number, userId: number): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        userId,
        triggerType: 'schedule',
        status: 'published',
        isActive: true,
      },
    });

    if (!workflow) {
      return;
    }

    const execution = await this.prisma.workflowExecution.create({
      data: {
        userId,
        workflowId: workflow.id,
        status: 'pending',
        context: {
          trigger: 'schedule',
          scheduled_at: new Date().toISOString(),
          __collected: {},
        },
      },
    });

    await this.jobs.enqueueExecuteWorkflow(execution.id);
    this.logger.log(`Scheduled workflow ${workflowId} execution ${execution.id}`);
  }
}
