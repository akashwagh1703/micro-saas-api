import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { WebhookIdempotencyService } from '../../common/webhook-idempotency/webhook-idempotency.service';

@Controller('hooks/workflows')
export class WorkflowWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  @Post(':token')
  async invoke(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Headers('x-idempotency-key') xIdempotencyKey: string | undefined,
  ) {
    const idempotencyKey =
      idempotencyKeyHeader?.trim() ||
      xIdempotencyKey?.trim() ||
      createHash('sha256').update(`${token}:${JSON.stringify(body ?? {})}`).digest('hex').slice(0, 32);

    if (!(await this.idempotency.claim('workflow', `${token}:${idempotencyKey}`))) {
      return { success: true, duplicate: true };
    }

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
