import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserStateService } from '../user-state.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  buildQuickDatePickItems,
  createDynamicInteractiveTemplate,
  resolveContactPhone,
  resolveNextNodeIdFromWorkflow,
  substituteContext,
} from './booking-node.helpers';

interface PickOptionRow {
  text: string;
  description?: string;
  value: string;
}

/** Sends a WhatsApp button/list picker and pauses until the customer taps an option. */
@Injectable()
export class PickOptionsNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(PickOptionsNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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
        return { success: false, error: 'pick_options node has no outgoing edge' };
      }

      const field = String(data.field ?? '').trim();
      if (!field) {
        return { success: false, error: 'pick_options node requires a context field' };
      }

      const mode = String(data.mode ?? 'static');
      let items;

      if (mode === 'date_quick_pick') {
        items = buildQuickDatePickItems(nextNodeId, field);
      } else {
        const options = await this.resolveOptions(execution.userId, data);
        if (!Array.isArray(options) || options.length === 0) {
          return { success: false, error: 'pick_options node requires at least one option' };
        }

        items = options.slice(0, 10).map((option, index) => {
          const value = String(option.value ?? option.text ?? '').trim();
          return {
            optionText: String(option.text ?? value).trim(),
            description: option.description ? String(option.description) : undefined,
            displayOrder: index,
            nextNodeId,
            metadata: {
              [field]: value,
              context_field: field,
              context_value: value,
            },
          };
        });
      }

      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-pick`,
        header: data.header ? substituteContext(String(data.header), context) : undefined,
        body: substituteContext(
          String(data.body ?? 'Tap an option below to continue:'),
          context,
        ),
        footer: data.footer ? substituteContext(String(data.footer), context) : undefined,
        items,
        useButtons: items.length <= 3,
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
          options_offered: items.length,
          template_id: template.id,
          pick_field: field,
        },
      };
    } catch (error: any) {
      this.logger.error(`pick_options failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async resolveOptions(
    userId: number,
    data: Record<string, unknown>,
  ): Promise<PickOptionRow[]> {
    if (data.options_source === 'salon_services' || data.options_source === 'appointment_services') {
      const services = await this.settings.getAppointmentServices(userId);
      return services.map((s) => ({
        text: s.text,
        description: s.description,
        value: s.value,
      }));
    }
    return (data.options ?? []) as PickOptionRow[];
  }
}
