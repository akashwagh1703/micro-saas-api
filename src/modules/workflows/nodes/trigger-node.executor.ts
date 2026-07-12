import { Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import { businessLabel } from '../business-workflow';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class TriggerNodeExecutor implements NodeExecutor {
  constructor(private readonly settings: SettingsService) {}

  async execute(
    execution: WorkflowExecution,
    _node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const businessCategory = await this.settings.get(execution.userId, 'business_category');
    const businessDescription = await this.settings.get(execution.userId, 'business_description');
    const business_label = businessCategory ? businessLabel(businessCategory) : '';
    const business_name = businessDescription?.trim() || business_label || 'Our business';

    return {
      success: true,
      output: {
        trigger: context.trigger ?? 'message',
        message: context.message ?? '',
        channel: context.channel ?? 'whatsapp',
        contact_phone: context.contact_phone ?? '',
        contact_name: context.contact_name ?? '',
        contact_username: context.contact_username ?? '',
        payload: context.payload ?? null,
        business_label,
        business_name,
      },
    };
  }
}
