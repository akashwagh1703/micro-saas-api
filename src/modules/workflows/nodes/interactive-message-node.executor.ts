import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserStateService } from '../user-state.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';

/**
 * Interactive Message Node Executor
 * Sends interactive messages and pauses workflow until user responds.
 */
@Injectable()
export class InteractiveMessageNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(InteractiveMessageNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userStateService: UserStateService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: any,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    try {
      const templateId = node.data?.templateId;
      if (!templateId) {
        return {
          success: false,
          error: 'Interactive message node is not configured (missing template)',
        };
      }

      const template = await this.prisma.interactiveMessageTemplate.findUnique({
        where: { id: templateId },
        include: {
          options: {
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!template) {
        return {
          success: false,
          error: `Template not found (id=${templateId})`,
        };
      }

      let contactPhoneNumber = context.contact_phone;

      if (!contactPhoneNumber && execution.contactId) {
        const contact = await this.prisma.contact.findUnique({
          where: { id: execution.contactId },
        });
        contactPhoneNumber = contact?.phone;
      }

      if (!contactPhoneNumber) {
        return {
          success: false,
          error: 'No contact phone number in context or execution',
        };
      }

      await this.jobs.enqueueSendInteractiveMessage({
        userId: execution.userId,
        phoneNumber: contactPhoneNumber,
        conversationId: execution.conversationId || 0,
        templateId,
        workflowId: execution.workflowId,
        nodeId: node.id,
      });

      await this.userStateService.saveUserState(
        execution.userId,
        contactPhoneNumber,
        execution.workflowId,
        node.id,
        String(templateId),
        'WAITING_FOR_RESPONSE',
      );

      return {
        success: true,
        pause: true,
        output: {
          interactive_message_sent: true,
          template_id: templateId,
          template_name: template.name,
          options_count: template.options.length,
        },
      };
    } catch (error: any) {
      this.logger.error(`Error in interactive message executor: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
