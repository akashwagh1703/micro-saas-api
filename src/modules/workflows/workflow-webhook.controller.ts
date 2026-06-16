import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';

@Controller('hooks/workflows')
export class WorkflowWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  @Post(':token')
  async invoke(@Param('token') token: string, @Body() body: Record<string, unknown>) {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        webhookToken: token,
        status: 'published',
        isActive: true,
        triggerType: 'webhook',
        isArchived: false,
      },
    });

    if (!workflow) {
      throw new NotFoundException('Webhook not found');
    }

    if (!(await this.billing.hasPlatformAccess(workflow.userId))) {
      throw new ForbiddenException('Workflow owner subscription inactive');
    }

    const execution = await this.prisma.workflowExecution.create({
      data: {
        userId: workflow.userId,
        workflowId: workflow.id,
        status: 'pending',
        context: {
          trigger: 'webhook',
          payload: (body ?? {}) as object,
          webhook_received_at: new Date().toISOString(),
          __collected: {},
        },
      },
    });

    await this.jobs.enqueueExecuteWorkflow(execution.id);

    return {
      success: true,
      execution_id: execution.id,
    };
  }
}
