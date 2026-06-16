import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialVaultService } from '../integrations/credential-vault.service';
import { WorkflowScheduleService } from './workflow-schedule.service';

type TriggerMode = 'message' | 'webhook' | 'schedule';

const TRIGGER_TYPE_MAP: Record<TriggerMode, string> = {
  message: 'message_received',
  webhook: 'webhook',
  schedule: 'schedule',
};

@Injectable()
export class WorkflowTriggerService {
  private readonly logger = new Logger(WorkflowTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVaultService,
    private readonly schedule: WorkflowScheduleService,
    private readonly config: ConfigService,
  ) {}

  extractTriggerMeta(definition: unknown) {
    const def = (definition ?? {}) as { nodes?: Array<{ type?: string; data?: Record<string, any> }> };
    const trigger = (def.nodes ?? []).find((n) => n.type === 'trigger');
    const data = trigger?.data ?? {};
    const mode = (data.trigger_type ?? 'message') as TriggerMode;
    const triggerType = TRIGGER_TYPE_MAP[mode] ?? 'message_received';

    return {
      triggerType,
      scheduleCron: triggerType === 'schedule' ? String(data.cron ?? '').trim() || null : null,
      scheduleTimezone: String(data.timezone ?? 'UTC').trim() || 'UTC',
    };
  }

  async syncFromDefinition(workflow: Workflow, options: { active?: boolean } = {}) {
    const meta = this.extractTriggerMeta(workflow.definition);
    const data: Record<string, unknown> = {
      triggerType: meta.triggerType,
      scheduleCron: meta.scheduleCron,
      scheduleTimezone: meta.scheduleTimezone,
    };

    if (meta.triggerType === 'webhook') {
      if (!workflow.webhookToken) {
        data.webhookToken = this.vault.generateWebhookToken();
      }
    } else {
      data.webhookToken = null;
    }

    const updated = await this.prisma.workflow.update({
      where: { id: workflow.id },
      data,
    });

    const shouldSchedule =
      options.active ??
      (updated.status === 'published' && updated.isActive && updated.triggerType === 'schedule');

    if (shouldSchedule && updated.triggerType === 'schedule' && updated.scheduleCron) {
      await this.schedule.ensureGlobalTick();
    }

    return updated;
  }

  async onPublished(workflow: Workflow) {
    const updated = await this.syncFromDefinition(workflow, { active: true });
    this.logger.log(`Workflow ${updated.id} published with trigger ${updated.triggerType}`);
    return updated;
  }

  async onUnpublished(workflowId: number) {
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { webhookToken: null, scheduleCron: null },
    });
  }

  webhookUrl(workflow: Workflow): string | null {
    if (!workflow.webhookToken) {
      return null;
    }
    const base = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/hooks/workflows/${workflow.webhookToken}`;
  }
}
