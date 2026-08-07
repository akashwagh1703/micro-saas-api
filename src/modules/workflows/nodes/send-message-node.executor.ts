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

    // Allow {{catalog_image_url}} etc. in media_url; skip image send when unresolved/empty.
    const rawNodeMedia = String(data.media_url ?? data.welcome_image_url ?? '').trim();
    const resolvedNodeMedia = substituteContext(rawNodeMedia, context).trim();
    const nodeMedia =
      resolvedNodeMedia && !resolvedNodeMedia.includes('{{') ? resolvedNodeMedia : '';
    const settingMedia = (await this.settings.get(execution.userId, 'welcome_image_url'))?.trim();
    const preferCatalogImage = data.use_catalog_image === true;
    const catalogMedia = preferCatalogImage
      ? String(context.catalog_image_url ?? '').trim()
      : '';
    const mediaUrl =
      normalizeHttpsImageUrl(nodeMedia) ??
      normalizeHttpsImageUrl(catalogMedia) ??
      (rawNodeMedia ? null : normalizeHttpsImageUrl(settingMedia ?? '')) ??
      null;

    // Optional gallery nodes: no resolvable image → skip (don't send caption-only spam).
    const optionalMedia = data.optional_media === true || rawNodeMedia.includes('{{catalog_image');
    if (optionalMedia && !mediaUrl) {
      return {
        success: true,
        output: { skipped: true, reason: 'no_catalog_media' },
      };
    }

    // Optional text nodes (e.g. products list): skip when placeholder resolved empty.
    if (data.optional_text === true && !message.trim() && !mediaUrl) {
      return {
        success: true,
        output: { skipped: true, reason: 'empty_optional_text' },
      };
    }

    const text = message.trim() || fallbackMessage.trim() || 'Thanks for your message!';

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
