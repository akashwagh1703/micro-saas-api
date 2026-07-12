import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { InboxService } from '../inbox/inbox.service';
import { SendInteractiveMessageJob } from '../queue/queue.constants';

/** Sends interactive messages via WhatsApp API with retry logic. */
@Injectable()
export class InteractiveMessageProcessor {
  private readonly logger = new Logger(InteractiveMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappApi: WhatsAppApiService,
    private readonly crypto: CryptoService,
    private readonly inbox: InboxService,
  ) {}

  async handle(payload: SendInteractiveMessageJob): Promise<void> {
    this.logger.log(
      `Sending interactive message template ${payload.templateId} to ${payload.phoneNumber}`,
    );

    try {
      const account = await this.prisma.whatsAppAccount.findUnique({
        where: { userId: payload.userId },
      });

      if (!account) {
        this.logger.warn(`No WhatsApp account found for user ${payload.userId}`);
        throw new Error('No WhatsApp account configured');
      }

      const accessToken = this.crypto.decrypt(account.accessToken);
      if (!accessToken || !account.phoneNumberId) {
        this.logger.warn(`Missing WhatsApp credentials for user ${payload.userId}`);
        throw new Error('WhatsApp credentials missing');
      }

      const template = await this.prisma.interactiveMessageTemplate.findUnique({
        where: { id: payload.templateId },
        include: {
          options: { orderBy: { displayOrder: 'asc' } },
          messageType: true,
        },
      });

      if (!template) {
        this.logger.warn(`Interactive template ${payload.templateId} not found`);
        throw new Error(`Interactive template ${payload.templateId} not found`);
      }

      let result;
      switch (template.messageType.name) {
        case 'QUICK_REPLY':
          result = await this.whatsappApi.sendReplyButtons(
            accessToken,
            account.phoneNumberId,
            payload.phoneNumber,
            template.bodyText,
            template.options.map((opt) => ({
              id: String(opt.id),
              title: opt.optionText,
            })),
            {
              headerText: template.headerText,
              footerText: template.footerText,
            },
          );
          break;

        case 'LIST_MESSAGE':
          result = await this.whatsappApi.sendListMessage(
            accessToken,
            account.phoneNumberId,
            payload.phoneNumber,
            template.headerText || 'Choose an option',
            template.bodyText,
            template.options.map((opt) => ({
              id: String(opt.id),
              title: opt.optionText,
              description: opt.description || undefined,
            })),
          );
          break;

        case 'FLOW_BUTTON':
          result = await this.whatsappApi.sendFlowButton(
            accessToken,
            account.phoneNumberId,
            payload.phoneNumber,
            template.bodyText,
            template.options[0],
          );
          break;

        default:
          this.logger.warn(`Unknown message type: ${template.messageType.name}`);
          throw new Error(`Unknown interactive message type: ${template.messageType.name}`);
      }

      if (result.success) {
        const waMessageId = result.data?.messages?.[0]?.id ?? null;
        this.logger.log(`Interactive message ${waMessageId} sent successfully`);

        const inboxContent = this.buildInboxLabel(template);
        await this.inbox.recordBotOutgoing(
          payload.userId,
          payload.conversationId,
          inboxContent,
          {
            waMessageId,
            source: 'workflow_interactive',
            workflowId: payload.workflowId,
            nodeId: payload.nodeId,
            templateId: payload.templateId,
          },
        );
      } else {
        this.logger.error(`Failed to send interactive message: ${result.message}`);
        throw new Error(result.message || 'Failed to send interactive message');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Interactive message processor error: ${message}`);
      throw error;
    }
  }

  private buildInboxLabel(template: {
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    options: { optionText: string; description: string | null }[];
  }): string {
    const lines: string[] = [];
    if (template.headerText?.trim()) {
      lines.push(template.headerText.trim());
    }
    if (template.bodyText?.trim()) {
      lines.push(template.bodyText.trim());
    }
    if (template.footerText?.trim()) {
      lines.push(template.footerText.trim());
    }
    if (template.options.length > 0) {
      lines.push('');
      for (const opt of template.options) {
        const desc = opt.description ? ` — ${opt.description}` : '';
        lines.push(`• ${opt.optionText}${desc}`);
      }
    }
    return lines.join('\n');
  }
}
