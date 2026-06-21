import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';

/**
 * Interactive Message Node Executor
 * Handles execution of interactive message nodes (buttons, lists, flow buttons)
 * Sends the interactive message and pauses workflow until user responds
 */
@Injectable()
export class InteractiveMessageNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(InteractiveMessageNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: any,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    try {
      // Get template ID from node configuration
      const templateId = node.data?.templateId;
      if (!templateId) {
        return {
          success: false,
          error: 'Interactive message node is not configured (missing template)',
        };
      }

      // Get the interactive message template
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

      // Get contact phone number from context or execution
      let contactPhoneNumber = context.contact_phone;
      
      if (!contactPhoneNumber && execution.contactId) {
        // Fetch from database if we have contactId
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

      // Queue the interactive message to be sent
      // This allows credentials to be fetched at send time
      await this.jobs.enqueueSendInteractiveMessage({
        userId: execution.userId,
        phoneNumber: contactPhoneNumber,
        conversationId: execution.conversationId || 0,
        templateId,
        workflowId: execution.workflowId,
        nodeId: node.id,
      });

      // Save user state - workflow pauses waiting for response
      await this.saveUserState(
        contactPhoneNumber,
        execution.workflowId,
        node.id,
        templateId,
        'WAITING_FOR_RESPONSE',
      );

      // Return pause - workflow will resume when button is clicked
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
      this.logger.error(
        `Error in interactive message executor: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Save user state when waiting for interactive message response
   */
  private async saveUserState(
    phoneNumber: string,
    workflowId: number,
    nodeId: string,
    templateId: number,
    status: string,
  ): Promise<void> {
    try {
      await this.prisma.userWorkflowState.upsert({
        where: { phoneNumber },
        update: {
          workflowId,
          currentNodeId: nodeId,
          status,
          metadata: {
            templateId,
            lastUpdated: new Date().toISOString(),
          } as any,
          updatedAt: new Date(),
        },
        create: {
          phoneNumber,
          workflowId,
          currentNodeId: nodeId,
          status,
          metadata: {
            templateId,
            createdAt: new Date().toISOString(),
          } as any,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to save user state: ${error}`);
      // Don't fail the entire execution if we can't save state
      // The response handler can still work
    }
  }
}
