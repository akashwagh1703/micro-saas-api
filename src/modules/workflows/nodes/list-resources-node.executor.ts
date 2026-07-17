import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { AvailabilityService } from '../../availability/availability.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserStateService } from '../user-state.service';
import { WorkflowInteractiveSendService } from '../workflow-interactive-send.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  buildBookingRetryItems,
  createDynamicInteractiveTemplate,
  resolveBookingFlowNodeIds,
  resolveContactPhone,
  resolveNextNodeAfterResources,
  resolveNextNodeIdFromWorkflow,
  substituteContext,
} from './booking-node.helpers';

/** Lists bookable resources (barbers, doctors, etc.) as a WhatsApp interactive picker. */
@Injectable()
export class ListResourcesNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(ListResourcesNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly userStateService: UserStateService,
    private readonly interactiveSend: WorkflowInteractiveSendService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    try {
      const data = node.data ?? {};
      const contactPhone = await resolveContactPhone(this.prisma, execution, context);
      if (!contactPhone) {
        return { success: false, error: 'No contact phone number in context or execution' };
      }

      const { data: resources } = await this.availability.listResources(execution.userId);
      const bookable = resources.filter(
        (r) =>
          r.is_active &&
          (r.schedules ?? []).some((s) => s.is_active !== false),
      );

      if (bookable.length === 0) {
        const body = substituteContext(
          String(
            data.empty_message ??
              'Sorry, no one is available for booking on *{{preferred_date}}* right now.\n\nTry another day below:',
          ),
          context,
        );

        const flowIds = await resolveBookingFlowNodeIds(this.prisma, execution.workflowId);
        const retryItems = buildBookingRetryItems({
          pickDateNodeId: flowIds.pickDateNodeId,
          listResourcesNodeId: null,
          pickTimePeriodNodeId: null,
        });

        if (retryItems.length > 0) {
          const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
            name: `wf-${execution.id}-${node.id}-empty-retry`,
            header: 'No one available',
            body,
            items: retryItems,
            useButtons: true,
          });

          const delivered = await this.interactiveSend.deliverTemplate({
            execution,
            contactPhone,
            templateId: template.id,
            nodeId: node.id,
          });

          if (delivered.success) {
            await this.userStateService.saveUserState(
              execution.userId,
              contactPhone,
              execution.workflowId,
              node.id,
              String(template.id),
              'WAITING_FOR_RESPONSE',
            );
            return { success: true, pause: true, output: { resources_offered: 0, retry: true } };
          }
        }

        await this.jobs.enqueueSendMessage({
          userId: execution.userId,
          conversationId: execution.conversationId!,
          content: body,
        });
        return { success: true, pause: true, output: { resources_offered: 0 } };
      }

      const nextNodeId = await resolveNextNodeAfterResources(
        this.prisma,
        execution.workflowId,
        node.id,
      );
      if (!nextNodeId) {
        return { success: false, error: 'list_resources node has no outgoing edge' };
      }

      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-resources`,
        header: data.header ? substituteContext(String(data.header), context) : 'Choose who to book with',
        body: substituteContext(
          String(data.body ?? 'Select a team member to continue with your appointment:'),
          context,
        ),
        items: bookable.map((resource, index) => ({
          optionText: resource.name,
          description: resource.type,
          displayOrder: index,
          nextNodeId,
          metadata: {
            resource_id: resource.id,
            resource_name: resource.name,
            selected_resource_id: resource.id,
          },
        })),
        useButtons: bookable.length <= 3,
      });

      const delivered = await this.interactiveSend.deliverTemplate({
        execution,
        contactPhone,
        templateId: template.id,
        nodeId: node.id,
      });

      if (!delivered.success) {
        return { success: false, error: delivered.error ?? 'Failed to send resource picker' };
      }

      await this.userStateService.saveUserState(
        execution.userId,
        contactPhone,
        execution.workflowId,
        node.id,
        String(template.id),
        'WAITING_FOR_RESPONSE',
      );

      return {
        success: true,
        pause: true,
        output: {
          resources_offered: bookable.length,
          template_id: template.id,
        },
      };
    } catch (error: any) {
      this.logger.error(`list_resources failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
