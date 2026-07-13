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
  buildTimePeriodPickItems,
  createDynamicInteractiveTemplate,
  filterSlotsByTimePeriod,
  formatSlotLabel,
  normalizePreferredDate,
  normalizeTimePeriod,
  periodsWithAvailableSlots,
  resolveContactPhone,
  resolveNextNodeIdFromWorkflow,
  substituteContext,
  TIME_PERIOD_LABELS,
  type TimePeriod,
} from './booking-node.helpers';

/** Shows available time slots for the selected resource, date, and time of day. */
@Injectable()
export class ListSlotsNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(ListSlotsNodeExecutor.name);

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
        await this.enqueueText(execution, invalidMessage);
        return { success: true, stop: true, output: { slots_offered: 0, invalid_date: true } };
      }

      const contactPhone = await resolveContactPhone(this.prisma, execution, context);
      if (!contactPhone) {
        return { success: false, error: 'No contact phone number in context or execution' };
      }

      const timePeriod = normalizeTimePeriod(context.time_period);
      if (!timePeriod) {
        return this.promptForTimePeriod(execution, node, contactPhone, data, {
          ...context,
          preferred_date: date,
          resource_name: context.resource_name,
        });
      }

      const slotsResponse = await this.availability.getSlots(execution.userId, date, resourceId);
      const resourceRow = slotsResponse.resources[0];
      const allSlots = resourceRow?.slots ?? [];
      const timeZone = slotsResponse.timezone ?? 'Asia/Kolkata';
      const resourceName = context.resource_name ?? resourceRow?.resource_name ?? 'your stylist';
      const slotContext = {
        ...context,
        preferred_date: date,
        resource_name: resourceName,
        time_period: timePeriod,
      };

      const periodSlots = filterSlotsByTimePeriod(allSlots, timePeriod, timeZone);

      if (periodSlots.length === 0) {
        return this.handleNoSlots(
          execution,
          node,
          contactPhone,
          data,
          slotContext,
          allSlots,
          timePeriod,
          timeZone,
        );
      }

      const nextNodeId = await resolveNextNodeIdFromWorkflow(
        this.prisma,
        execution.workflowId,
        node.id,
      );
      if (!nextNodeId) {
        return { success: false, error: 'list_slots node has no outgoing edge' };
      }

      const periodLabel = TIME_PERIOD_LABELS[timePeriod].split('(')[0].trim();
      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-slots-${timePeriod}`,
        header: data.header
          ? substituteContext(String(data.header), slotContext)
          : substituteContext('{{business_name}} — pick a time', slotContext),
        body: substituteContext(
          String(
            data.body ??
              `*${periodLabel}* slots with *{{resource_name}}* on *{{preferred_date}}*.\n\nTap *View options* to choose:`,
          ),
          slotContext,
        ),
        items: periodSlots.map((slot, index) => {
          const label = formatSlotLabel(slot.starts_at, timeZone);
          const timeOnly = label.split(', ').slice(-1)[0] ?? label;
          return {
            optionText: timeOnly.slice(0, 20),
            description: label.slice(0, 72),
            displayOrder: index,
            nextNodeId,
            metadata: {
              resource_id: resourceId,
              resource_name: resourceName,
              selected_resource_id: resourceId,
              starts_at: slot.starts_at,
              ends_at: slot.ends_at,
              selected_slot_starts_at: slot.starts_at,
              slot_starts_at: slot.starts_at,
              slot_ends_at: slot.ends_at,
              preferred_date: date,
              time_period: timePeriod,
            },
          };
        }),
        useButtons: periodSlots.length <= 3,
      });

      const delivered = await this.interactiveSend.deliverTemplate({
        execution,
        contactPhone,
        templateId: template.id,
        nodeId: node.id,
      });

      if (!delivered.success) {
        return { success: false, error: delivered.error ?? 'Failed to send slot picker' };
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
          slots_offered: periodSlots.length,
          slot_date: date,
          resource_id: resourceId,
          time_period: timePeriod,
          template_id: template.id,
        },
      };
    } catch (error: any) {
      this.logger.error(`list_slots failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async handleNoSlots(
    execution: WorkflowExecution,
    node: Record<string, any>,
    contactPhone: string,
    data: Record<string, any>,
    context: Record<string, any>,
    allSlots: { starts_at: string; ends_at: string }[],
    timePeriod: TimePeriod,
    timeZone: string,
  ): Promise<NodeExecutionResult> {
    const pickDateNodeId = 'pick-date';
    const listResourcesNodeId = 'list-resources';
    const pickTimePeriodNodeId = 'pick-time-period';
    const alternatePeriods = periodsWithAvailableSlots(allSlots, timeZone, timePeriod);

    const periodLabel = TIME_PERIOD_LABELS[timePeriod].split('(')[0].trim().toLowerCase();
    const body =
      allSlots.length === 0
        ? substituteContext(
            String(
              data.no_slots_message ??
                'Sorry, no slots are open on *{{preferred_date}}* with *{{resource_name}}*.\n\nTry another option below:',
            ),
            context,
          )
        : substituteContext(
            String(
              data.no_period_slots_message ??
                `No *${periodLabel}* slots are open with *{{resource_name}}* on *{{preferred_date}}*.\n\nTry another time or option below:`,
            ),
            context,
          );

    const retryItems = buildBookingRetryItems({
      pickDateNodeId,
      listResourcesNodeId,
      pickTimePeriodNodeId,
      listSlotsNodeId: node.id,
      alternatePeriods,
    });

    if (retryItems.length === 0) {
      await this.enqueueText(execution, body);
      return { success: true, stop: true, output: { slots_offered: 0, slot_date: context.preferred_date } };
    }

    const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
      name: `wf-${execution.id}-${node.id}-retry`,
      header: 'Try another option',
      body,
      items: retryItems.slice(0, 10),
      useButtons: retryItems.length <= 3,
    });

    const delivered = await this.interactiveSend.deliverTemplate({
      execution,
      contactPhone,
      templateId: template.id,
      nodeId: node.id,
    });

    if (!delivered.success) {
      await this.enqueueText(execution, body);
      return { success: true, stop: true, output: { slots_offered: 0 } };
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
        slots_offered: 0,
        retry_offered: retryItems.length,
        time_period: timePeriod,
      },
    };
  }

  private async promptForTimePeriod(
    execution: WorkflowExecution,
    node: Record<string, any>,
    contactPhone: string,
    data: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const body = substituteContext(
      String(
        data.time_period_message ??
          'You chose *{{resource_name}}* for *{{preferred_date}}*.\n\nWhat time of day works best? Tap *View options*:',
      ),
      context,
    );

    const items = buildTimePeriodPickItems(node.id, 'time_period');
    const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
      name: `wf-${execution.id}-${node.id}-time-period`,
      header: substituteContext(
        String(data.time_period_header ?? '🕐 Choose time of day'),
        context,
      ),
      body,
      items,
      useButtons: false,
    });

    const delivered = await this.interactiveSend.deliverTemplate({
      execution,
      contactPhone,
      templateId: template.id,
      nodeId: node.id,
    });

    if (!delivered.success) {
      this.logger.warn(`Time period picker failed: ${delivered.error}`);
      await this.enqueueText(
        execution,
        `${body}\n\nReply with: Morning, Afternoon, Evening, or Night`,
      );
      return { success: true, stop: true, output: { time_period_prompt_fallback: true } };
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
      output: { time_period_prompt: true, template_id: template.id },
    };
  }

  private async enqueueText(execution: WorkflowExecution, message: string): Promise<void> {
    if (!execution.conversationId) return;
    await this.jobs.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: message,
    });
  }
}
