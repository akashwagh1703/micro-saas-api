import { Controller, Get, Inject, Logger, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';
import { InboxService } from '../inbox/inbox.service';
import { InteractiveMessageHandlerService } from '../workflows/interactive-message-handler.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import {
  extractWhatsAppInboundText,
  extractWhatsAppInteractiveOptionId,
} from './whatsapp-webhook.parser';

/**
 * Meta WhatsApp webhook endpoints. These return plain text (not JSON) to match
 * Meta's expectations and the original Laravel behavior.
 */
@Controller('webhook/whatsapp')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly api: WhatsAppApiService,
    private readonly inbox: InboxService,
    private readonly interactiveHandler: InteractiveMessageHandlerService,
    private readonly config: ConfigService,
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
  ) {}

  @Get(':userId')
  async verify(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const q = req.query as Record<string, string>;
    const mode = q['hub.mode'] ?? q['hub_mode'];
    const token = q['hub.verify_token'] ?? q['hub_verify_token'];
    const challenge = q['hub.challenge'] ?? q['hub_challenge'];

    const creds = await this.whatsapp.credentials(userId);

    if (mode === 'subscribe' && creds && token === creds.verifyToken) {
      res.status(200).type('text/plain').send(challenge ?? '');
      return;
    }
    res.status(403).type('text/plain').send('Forbidden');
  }

  @Post(':userId')
  async receive(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const creds = await this.whatsapp.credentials(userId);
    if (!creds || !creds.account.isConnected) {
      res.status(200).type('text/plain').send('OK');
      return;
    }

    if (!this.signatureIsValid(req, creds.appSecret, userId)) {
      this.logger.warn(`Webhook signature rejected for user ${userId}`);
      res.status(403).type('text/plain').send('Invalid signature');
      return;
    }

    const payload = req.body ?? {};

    if (this.isStatusUpdate(payload)) {
      res.status(200).type('text/plain').send('OK');
      return;
    }

    try {
      const entry = payload?.entry?.[0]?.changes?.[0]?.value ?? null;
      const messages = entry?.messages ?? [];

      for (const waMessage of messages) {
        const from = waMessage.from ?? null;
        const waId = waMessage.id ?? null;
        const waType = String(waMessage.type ?? 'text');
        const contactName = entry?.contacts?.[0]?.profile?.name ?? null;

        if (!from) {
          continue;
        }

        if (waType === 'interactive') {
          const optionId = extractWhatsAppInteractiveOptionId(
            waMessage as Record<string, unknown>,
          );
          if (optionId !== null) {
            const handled = await this.interactiveHandler.handleButtonResponse(
              userId,
              from,
              optionId,
            );
            if (handled.success) {
              this.logger.log(
                `Interactive reply handled for tenant ${userId} / ${from} (option ${optionId})`,
              );
              continue;
            }
          }
        }

        const text =
          extractWhatsAppInboundText(waMessage as Record<string, unknown>) ??
          (waType === 'document' ? '[Resume document]' : null);

        if (!text) {
          continue;
        }

        if (waId) {
          const duplicate = await this.inbox.findMessageByWaId(userId, waId);
          if (duplicate) {
            continue;
          }
        }

        const contact = await this.inbox.findOrCreateContact(userId, from, contactName);
        const conversation = await this.inbox.findOrCreateConversation(
          userId,
          contact,
          creds.account.id,
        );
        const { message, isNew } = await this.inbox.storeIncomingMessage(
          userId,
          contact,
          conversation,
          text,
          { waMessageId: waId },
          { raw: waMessage },
        );

        if (isNew) {
          await this.queue.enqueueProcessIncoming(message.id);
        }
      }
    } catch (e: any) {
      this.logger.error(`Webhook processing error for user ${userId}: ${e.message}`);
    }

    res.status(200).type('text/plain').send('OK');
  }

  private signatureIsValid(req: Request, appSecret: string | null, userId: number): boolean {
    if (!appSecret) {
      if (this.unverifiedWebhooksAllowed()) {
        this.logger.warn(
          `WhatsApp webhook accepted WITHOUT signature verification (app_secret missing, dev override) for user ${userId}`,
        );
        return true;
      }
      this.logger.warn(
        `WhatsApp webhook rejected: app_secret not configured for user ${userId}. Configure the Meta app secret in Settings to receive messages.`,
      );
      return false;
    }
    const raw = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.api.verifyWebhookSignature(
      raw,
      req.header('X-Hub-Signature-256') ?? undefined,
      appSecret,
    );
  }

  /** Dev-only escape hatch to accept webhooks before an app secret is configured. */
  private unverifiedWebhooksAllowed(): boolean {
    return (
      this.config.get<string>('NODE_ENV') !== 'production' &&
      String(this.config.get<string>('ALLOW_UNVERIFIED_WEBHOOKS') ?? '').toLowerCase() === 'true'
    );
  }

  private isStatusUpdate(payload: any): boolean {
    const statuses = payload?.entry?.[0]?.changes?.[0]?.value?.statuses ?? null;
    return !!statuses && statuses.length > 0;
  }
}
