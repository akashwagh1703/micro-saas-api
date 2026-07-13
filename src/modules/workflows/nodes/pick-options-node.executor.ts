import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import {
  defaultServicesForVertical,
} from '../../../platform/appointment-services';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserStateService } from '../user-state.service';
import { WorkflowInteractiveSendService } from '../workflow-interactive-send.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  buildQuickDatePickItems,
  buildTimePeriodPickItems,
  createDynamicInteractiveTemplate,
  enqueueWorkflowText,
  resolveContactPhone,
  resolveNextNodeAfterTimePeriod,
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

      const mode = String(data.mode ?? 'static');
      const field = String(data.field ?? '').trim();
      if (!field && mode !== 'date_quick_pick') {
        return { success: false, error: 'pick_options node requires a context field' };
      }

      const nextNodeId =
        mode === 'time_period_pick'
          ? await resolveNextNodeAfterTimePeriod(this.prisma, execution.workflowId, node.id)
          : await resolveNextNodeIdFromWorkflow(this.prisma, execution.workflowId, node.id);
      if (!nextNodeId) {
        return { success: false, error: 'pick_options node has no outgoing edge' };
      }

      let items;

      if (mode === 'date_quick_pick') {
        items = buildQuickDatePickItems(nextNodeId, field || 'preferred_date');
      } else if (mode === 'time_period_pick') {
        items = buildTimePeriodPickItems(nextNodeId, field || 'time_period');
      } else {
        const options = await this.resolveOptions(execution.userId, data);
        if (!Array.isArray(options) || options.length === 0) {
          return { success: false, error: 'pick_options node requires at least one option' };
        }

        items = options.map((option, index) => {
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
        useButtons: mode !== 'time_period_pick' && items.length <= 3,
      });

      const delivered = await this.interactiveSend.deliverTemplate({
        execution,
        contactPhone,
        templateId: template.id,
        nodeId: node.id,
      });

      if (!delivered.success) {
        const fallbackBody = [
          substituteContext(String(data.body ?? 'Please choose an option:'), context),
          ...items.map((item, i) => `${i + 1}. ${item.optionText}`),
        ].join('\n');
        await enqueueWorkflowText(this.jobs, execution, fallbackBody);
        this.logger.warn(`pick_options deliver failed (${mode}): ${delivered.error}`);
        return {
          success: true,
          stop: true,
          output: { deliver_fallback: true, pick_field: field || mode },
        };
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
      if (services.length > 0) {
        return services.map((s) => ({
          text: s.text,
          description: s.description,
          value: s.value,
        }));
      }
      const category = await this.settings.get(userId, 'business_category');
      return defaultServicesForVertical(category).map((s) => ({
        text: s.text,
        description: s.description,
        value: s.value,
      }));
    }
    return (data.options ?? []) as PickOptionRow[];
  }
}
