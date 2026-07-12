import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { AvailabilityService } from '../../availability/availability.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserStateService } from '../user-state.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  createDynamicInteractiveTemplate,
  enqueueWorkflowText,
  formatSlotLabel,
  normalizePreferredDate,
  resolveContactPhone,
  resolveNextNodeIdFromWorkflow,
  substituteContext,
} from './booking-node.helpers';

/** Shows available time slots for the selected resource and date. */
@Injectable()
export class ListSlotsNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(ListSlotsNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly userStateService: UserStateService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    try {
      const data = node.data ?? {};
      const resourceId = Number(
        context.resource_id ?? context.selected_resource_id ?? data.resource_id,
      );
      if (!resourceId || Number.isNaN(resourceId)) {
        return { success: false, error: 'No resource selected for slot listing' };
      }

      const dateField = String(data.date_field ?? 'preferred_date');
      const rawDate = context[dateField] ?? context.preferred_date ?? data.date;
      const date = normalizePreferredDate(rawDate);
      if (!date) {
        const invalidMessage = substituteContext(
          String(
            data.invalid_date_message ??
              'Please go back and tap *Today* or *Tomorrow* to pick your visit date.',
          ),
          { ...context, preferred_date: String(rawDate ?? '') },
        );
        await enqueueWorkflowText(this.jobs, execution, invalidMessage);
        return { success: true, stop: true, output: { slots_offered: 0, invalid_date: true } };
      }

      const slotsResponse = await this.availability.getSlots(execution.userId, date, resourceId);
      const resourceRow = slotsResponse.resources[0];
      const slots = (resourceRow?.slots ?? []).slice(0, 10);

      if (slots.length === 0) {
        const noSlotsMessage = substituteContext(
          String(
            data.no_slots_message ??
              'Sorry, no slots are open on {{preferred_date}} with {{resource_name}}. Please tap *Today* or *Tomorrow* again to try another day.',
          ),
          {
            ...context,
            preferred_date: date,
            resource_name: context.resource_name ?? resourceRow?.resource_name ?? 'your stylist',
          },
        );
        await enqueueWorkflowText(this.jobs, execution, noSlotsMessage);
        return { success: true, stop: true, output: { slots_offered: 0, slot_date: date } };
      }

      const contactPhone = await resolveContactPhone(this.prisma, execution, context);
      if (!contactPhone) {
        return { success: false, error: 'No contact phone number in context or execution' };
      }

      const nextNodeId = await resolveNextNodeIdFromWorkflow(
        this.prisma,
        execution.workflowId,
        node.id,
      );
      if (!nextNodeId) {
        return { success: false, error: 'list_slots node has no outgoing edge' };
      }

      const timeZone = slotsResponse.timezone ?? 'Asia/Kolkata';
      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-slots`,
        header: data.header
          ? substituteContext(String(data.header), context)
          : `Slots on ${date}`,
        body: substituteContext(
          String(
            data.body ??
              'Pick a time for {{resource_name}} on {{preferred_date}}:',
          ),
          {
            ...context,
            preferred_date: date,
            resource_name: context.resource_name ?? resourceRow?.resource_name ?? 'your stylist',
          },
        ),
        items: slots.map((slot, index) => {
          const label = formatSlotLabel(slot.starts_at, timeZone);
          const timeOnly = label.split(', ').slice(-1)[0] ?? label;
          return {
            optionText: timeOnly.slice(0, 20),
            description: label.slice(0, 72),
            displayOrder: index,
            nextNodeId,
            metadata: {
              resource_id: resourceId,
              resource_name: context.resource_name ?? resourceRow?.resource_name,
              selected_resource_id: resourceId,
              starts_at: slot.starts_at,
              ends_at: slot.ends_at,
              selected_slot_starts_at: slot.starts_at,
              slot_starts_at: slot.starts_at,
              slot_ends_at: slot.ends_at,
              preferred_date: date,
            },
          };
        }),
        useButtons: slots.length <= 3,
      });

      await this.jobs.enqueueSendInteractiveMessage({
        userId: execution.userId,
        phoneNumber: contactPhone,
        conversationId: execution.conversationId || 0,
        templateId: template.id,
        workflowId: execution.workflowId,
        nodeId: node.id,
      });

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
          slots_offered: slots.length,
          slot_date: date,
          resource_id: resourceId,
          template_id: template.id,
        },
      };
    } catch (error: any) {
      this.logger.error(`list_slots failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
