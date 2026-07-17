import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { AvailabilityService } from '../../availability/availability.service';
import { InboxService } from '../../inbox/inbox.service';
import { SettingsService } from '../../settings/settings.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { PrismaService } from '../../../prisma/prisma.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  enqueueWorkflowText,
  formatSlotLabel,
  resolveBookingFlowNodeIds,
  scheduleWorkflowResume,
  substituteContext,
} from './booking-node.helpers';

/** Creates a pending booking request and sends the customer a WhatsApp acknowledgment. */
@Injectable()
export class BookSlotNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(BookSlotNodeExecutor.name);

  constructor(
    private readonly availability: AvailabilityService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
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
      const startsAt = String(
        context.slot_starts_at ?? context.selected_slot_starts_at ?? data.starts_at ?? '',
      );
      const endsAt = String(context.slot_ends_at ?? data.ends_at ?? '');

      if (!resourceId || !startsAt || !endsAt) {
        return { success: false, error: 'Missing resource or slot selection for booking' };
      }

      const pendingTemplate = String(
        data.pending_message ??
          'Thanks {{contact_name}}! We received your request for *{{service_type}}* with *{{resource_name}}* on *{{booking_time}}*.\n\nWe will check availability and confirm your booking shortly.',
      );
      const pendingHeader = String(data.pending_header ?? '{{business_name}}');
      const conflictTemplate = String(
        data.conflict_message ??
          'Sorry, that slot was just taken. Please ask for available slots again and pick another time.',
      );
      const bookingStatus = String(data.status ?? 'pending');

      try {
        const { booking } = await this.availability.createBooking(execution.userId, {
          resource_id: resourceId,
          starts_at: startsAt,
          ends_at: endsAt,
          contact_id: execution.contactId ?? undefined,
          conversation_id: execution.conversationId ?? undefined,
          workflow_execution_id: execution.id,
          service_label: context.service_type ? String(context.service_type) : undefined,
          status: bookingStatus,
        });

        const timeZone = (await this.settings.get(execution.userId, 'timezone')) || 'Asia/Kolkata';
        const bookingTime = formatSlotLabel(booking.starts_at, timeZone);
        const businessName = await this.resolveBusinessName(execution.userId, context);
        const pendingContext = {
          ...context,
          business_name: businessName,
          booking_id: booking.id,
          booking_status: booking.status,
          resource_name: booking.resource_name ?? context.resource_name,
          booking_time: bookingTime,
          slot_starts_at: booking.starts_at,
          selected_slot_starts_at: booking.starts_at,
        };

        const pendingBody = substituteContext(pendingTemplate, pendingContext);
        const pendingHeaderText = substituteContext(pendingHeader, pendingContext);

        if (execution.conversationId) {
          const body = pendingHeaderText.trim()
            ? `${pendingHeaderText.trim()}\n\n${pendingBody}`
            : pendingBody;
          const result = await this.inbox.sendInteractiveButtons(
            execution.userId,
            execution.conversationId,
            body,
            [{ id: `booking_pending_${booking.id}`, title: 'Got it' }],
            { source: 'booking_pending', workflowId: execution.workflowId, nodeId: node.id },
          );
          if (!result.success) {
            await enqueueWorkflowText(this.jobs, execution, body);
          }
        } else {
          await enqueueWorkflowText(this.jobs, execution, pendingBody);
        }

        return {
          success: true,
          output: {
            booking_id: booking.id,
            booking_status: booking.status,
            resource_id: booking.resource_id,
            resource_name: booking.resource_name,
            booking_time: bookingTime,
            slot_starts_at: booking.starts_at,
            slot_ends_at: booking.ends_at,
            selected_resource_id: booking.resource_id,
            selected_slot_starts_at: booking.starts_at,
            booking_pending: booking.status === 'pending',
          },
        };
      } catch (error: any) {
        if (error instanceof ConflictException || error?.status === 409) {
          const conflictMessage = substituteContext(conflictTemplate, context);
          await enqueueWorkflowText(this.jobs, execution, conflictMessage);
          const flowIds = await resolveBookingFlowNodeIds(this.prisma, execution.workflowId);
          await scheduleWorkflowResume(
            this.prisma,
            this.jobs,
            execution.id,
            flowIds.listSlotsNodeId,
            {},
            ['slot_starts_at', 'slot_ends_at', 'selected_slot_starts_at'],
          );
          return {
            success: true,
            pause: true,
            output: { booking_conflict: true, resumed_at: flowIds.listSlotsNodeId },
          };
        }
        throw error;
      }
    } catch (error: any) {
      this.logger.error(`book_slot failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async resolveBusinessName(
    userId: number,
    context: Record<string, any>,
  ): Promise<string> {
    const fromContext = String(context.business_name ?? '').trim();
    if (fromContext) return fromContext;
    const businessName = (await this.settings.get(userId, 'business_name'))?.trim();
    if (businessName) return businessName;
    const description = (await this.settings.get(userId, 'business_description'))?.trim();
    if (description) return description;
    return 'Our business';
  }
}
