import { Inject, Injectable } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { SettingsService } from '../../settings/settings.service';
import { InboxService } from '../../inbox/inbox.service';
import { substituteContext } from './booking-node.helpers';
import { resolveWelcomeImageUrl, normalizeHttpsImageUrl } from './welcome-image.helpers';
import { NodeExecutionResult, NodeExecutor } from './node-executor.interface';

@Injectable()
export class SendMessageNodeExecutor implements NodeExecutor {
  constructor(
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const data = node.data ?? {};
    const message = substituteContext(String(data.message ?? ''), context);
    const fallbackMessage = substituteContext(String(data.fallback_message ?? ''), context);
    const text = message.trim() || fallbackMessage || 'Thanks for your message!';

    const nodeMedia = String(data.media_url ?? data.welcome_image_url ?? '').trim();
    const settingMedia = (await this.settings.get(execution.userId, 'welcome_image_url'))?.trim();
    const mediaUrl =
      normalizeHttpsImageUrl(nodeMedia) ?? normalizeHttpsImageUrl(settingMedia ?? '') ?? null;

    if (mediaUrl && execution.conversationId) {
      const imageResult = await this.inbox.sendOutgoingImageByLink(
        execution.userId,
        execution.conversationId,
        mediaUrl,
        text,
        { source: 'workflow_send_message', workflowId: execution.workflowId, nodeId: node.id },
      );
      if (imageResult.success) {
        return {
          success: true,
          output: { queued: true, message: text, with_image: true },
        };
      }
    }

    await this.queue.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: text,
    });

    return {
      success: true,
      output: { queued: true, message: text },
    };
  }
}
