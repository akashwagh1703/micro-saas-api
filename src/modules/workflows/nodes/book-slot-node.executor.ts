import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { AvailabilityService } from '../../availability/availability.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import { enqueueWorkflowText, formatSlotLabel, substituteContext } from './booking-node.helpers';

/** Confirms a booking for the selected slot and sends the customer a WhatsApp confirmation. */
@Injectable()
export class BookSlotNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(BookSlotNodeExecutor.name);

  constructor(
    private readonly availability: AvailabilityService,
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

      const confirmTemplate = String(
        data.confirm_message ??
          '✅ Your appointment is confirmed!\n\nStylist: {{resource_name}}\nWhen: {{booking_time}}\nService: {{service_type}}\n\nSee you soon!',
      );
      const conflictTemplate = String(
        data.conflict_message ??
          'Sorry, that slot was just taken. Please ask for available slots again and pick another time.',
      );

      try {
        const { booking } = await this.availability.createBooking(execution.userId, {
          resource_id: resourceId,
          starts_at: startsAt,
          ends_at: endsAt,
          contact_id: execution.contactId ?? undefined,
          conversation_id: execution.conversationId ?? undefined,
          workflow_execution_id: execution.id,
          service_label: context.service_type ? String(context.service_type) : undefined,
        });

        const bookingTime = formatSlotLabel(booking.starts_at);
        const confirmation = substituteContext(confirmTemplate, {
          ...context,
          booking_id: booking.id,
          resource_name: booking.resource_name ?? context.resource_name,
          booking_time: bookingTime,
          slot_starts_at: booking.starts_at,
          selected_slot_starts_at: booking.starts_at,
        });

        await enqueueWorkflowText(this.jobs, execution, confirmation);

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
          },
        };
      } catch (error: any) {
        if (error instanceof ConflictException || error?.status === 409) {
          const conflictMessage = substituteContext(conflictTemplate, context);
          await enqueueWorkflowText(this.jobs, execution, conflictMessage);
          return {
            success: true,
            stop: true,
            output: { booking_conflict: true },
          };
        }
        throw error;
      }
    } catch (error: any) {
      this.logger.error(`book_slot failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
