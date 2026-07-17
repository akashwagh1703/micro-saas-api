import { Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { InboxService } from '../inbox/inbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeWhatsAppPhone } from './nodes/booking-node.helpers';

export interface DeliverInteractiveTemplateParams {
  execution: WorkflowExecution;
  contactPhone: string;
  templateId: number;
  nodeId: string;
  headerImageLink?: string | null;
  /** When true, list/button body was already sent as an image caption — use a short follow-up body. */
  skipWelcomeBodyInInteractive?: boolean;
}

/**
 * Delivers WhatsApp quick-reply buttons / list pickers using the same inbox path
 * as CareerAI (proven to render stacked action buttons on customer devices).
 */
@Injectable()
export class WorkflowInteractiveSendService {
  private readonly logger = new Logger(WorkflowInteractiveSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  async deliverTemplate(params: DeliverInteractiveTemplateParams): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { execution, contactPhone, templateId, nodeId, headerImageLink, skipWelcomeBodyInInteractive } =
      params;
    const conversationId = execution.conversationId;

    if (!conversationId) {
      return { success: false, error: 'No conversation linked to workflow execution' };
    }

    const template = await this.prisma.interactiveMessageTemplate.findUnique({
      where: { id: templateId },
      include: {
        options: { orderBy: { displayOrder: 'asc' } },
        messageType: true,
      },
    });

    if (!template) {
      return { success: false, error: `Interactive template ${templateId} not found` };
    }

    if (!template.options.length) {
      return { success: false, error: 'Interactive template has no options' };
    }

    const body = this.composeBody(template.headerText, template.bodyText, template.footerText);
    const meta = {
      source: 'workflow_interactive',
      workflowId: execution.workflowId,
      nodeId,
      templateId,
    };

    const phone = normalizeWhatsAppPhone(contactPhone);
    if (!phone) {
      return { success: false, error: 'Invalid contact phone' };
    }

    const imageLink = headerImageLink?.trim() || null;
    const shortFollowUpBody = 'Tap *View options* below to continue:';

    if (template.messageType.name === 'QUICK_REPLY') {
      const bodyOnly = skipWelcomeBodyInInteractive
        ? shortFollowUpBody
        : imageLink
          ? template.bodyText?.trim() || 'Tap an option below:'
          : this.composeBody(template.headerText, template.bodyText, template.footerText);

      const result = await this.inbox.sendInteractiveButtons(
        execution.userId,
        conversationId,
        bodyOnly,
        template.options.slice(0, 3).map((opt) => ({
          id: String(opt.id),
          title: opt.optionText,
        })),
        {
          ...meta,
          headerText: imageLink ? null : template.headerText,
          footerText: imageLink && !skipWelcomeBodyInInteractive ? template.footerText : null,
          headerImageLink: imageLink,
        },
      );

      if (!result.success) {
        this.logger.error(
          `Quick-reply buttons failed for tenant ${execution.userId} / ${phone}: ${result.error}`,
        );
        return { success: false, error: result.error ?? 'WhatsApp button send failed' };
      }

      this.logger.log(
        `Quick-reply buttons sent (${template.options.length} options) to ${phone}`,
      );
      return { success: true };
    }

    if (template.messageType.name === 'LIST_MESSAGE') {
      const listButton = 'View options';
      const chunks = this.chunkOptions(template.options, 10);
      const listBody = skipWelcomeBodyInInteractive
        ? shortFollowUpBody
        : body;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkBody =
          chunks.length > 1
            ? `${listBody}\n\n(${i + 1}/${chunks.length} — tap *${listButton}* to choose)`
            : listBody;
        const result = await this.inbox.sendInteractiveList(
          execution.userId,
          conversationId,
          template.headerText || 'Choose an option',
          chunkBody,
          chunk.map((opt) => ({
            id: String(opt.id),
            title: opt.optionText,
            description: opt.description ?? undefined,
          })),
          { ...meta, listButton },
        );

        if (!result.success) {
          this.logger.error(
            `List picker failed for tenant ${execution.userId} / ${phone}: ${result.error}`,
          );
          return { success: false, error: result.error ?? 'WhatsApp list send failed' };
        }
      }

      return { success: true };
    }

    return { success: false, error: `Unsupported message type: ${template.messageType.name}` };
  }

  private composeBody(
    header: string | null,
    body: string,
    footer: string | null,
  ): string {
    const lines: string[] = [];
    if (header?.trim()) lines.push(header.trim());
    if (body?.trim()) lines.push(body.trim());
    if (footer?.trim()) lines.push(footer.trim());
    return lines.join('\n\n') || 'Tap an option below:';
  }

  private chunkOptions<T>(options: T[], size: number): T[][] {
    if (options.length <= size) return [options];
    const chunks: T[][] = [];
    for (let i = 0; i < options.length; i += size) {
      chunks.push(options.slice(i, i + size));
    }
    return chunks;
  }
}
