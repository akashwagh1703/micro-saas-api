import { Controller, Get, Inject, Logger, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { InstagramService } from '../instagram/instagram.service';
import { InstagramApiService } from '../integrations/instagram-api.service';
import { InboxService } from '../inbox/inbox.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { parseInstagramWebhookPayload } from './instagram-webhook.parser';

/**
 * Meta Instagram DM webhook (Messenger Platform / Instagram Messaging).
 * Verify + receive mirror the WhatsApp webhook pattern.
 */
@Controller('webhook/instagram')
export class InstagramWebhooksController {
  private readonly logger = new Logger(InstagramWebhooksController.name);

  constructor(
    private readonly instagram: InstagramService,
    private readonly api: InstagramApiService,
    private readonly inbox: InboxService,
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
  ) {}

  @Get(':userId')
  async verify(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const q = req.query as Record<string, string | string[] | undefined>;
    const mode = this.queryString(q['hub.mode'] ?? q['hub_mode']);
    const token = this.queryString(q['hub.verify_token'] ?? q['hub_verify_token']);
    const challenge = this.queryString(q['hub.challenge'] ?? q['hub_challenge']);

    const creds = await this.instagram.credentials(userId);
    const expected = creds?.verifyToken?.trim() ?? '';
    const received = token?.trim() ?? '';

    if (mode === 'subscribe' && expected && received === expected) {
      this.logger.log(`Instagram webhook verified for user ${userId}`);
      res.status(200).type('text/plain').send(challenge ?? '');
      return;
    }

    this.logger.warn(
      `Instagram webhook verify failed for user ${userId} (mode=${mode ?? 'missing'}, has_creds=${!!creds}, has_stored_token=${!!expected}, token_match=${!!expected && received === expected})`,
    );
    res.status(403).type('text/plain').send('Forbidden');
  }

  private queryString(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  @Post(':userId')
  async receive(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const creds = await this.instagram.credentials(userId);
    if (!creds || !creds.account.isConnected) {
      res.status(200).type('text/plain').send('OK');
      return;
    }

    if (!this.signatureIsValid(req, creds.appSecret, userId)) {
      this.logger.warn(`Instagram webhook signature rejected for user ${userId}`);
      res.status(403).type('text/plain').send('Invalid signature');
      return;
    }

    const payload = req.body ?? {};
    const inbound = parseInstagramWebhookPayload(payload);

    try {
      for (const item of inbound) {
        const duplicate = await this.inbox.findMessageByExternalId(userId, item.messageId);
        if (duplicate) {
          continue;
        }

        const profile = await this.api.fetchSenderProfile(
          creds.accessToken ?? '',
          item.senderId,
        );

        const contact = await this.inbox.findOrCreateInstagramContact(
          userId,
          item.senderId,
          profile?.name ?? null,
          profile?.username ?? null,
        );
        const conversation = await this.inbox.findOrCreateConversation(
          userId,
          contact,
          null,
          creds.account.id,
        );

        const message = await this.inbox.storeIncomingMessage(
          userId,
          contact,
          conversation,
          item.text,
          { externalMessageId: item.messageId },
          { raw: item.raw, channel: 'instagram', sender_id: item.senderId },
        );

        await this.queue.enqueueProcessIncoming(message.id);
      }
    } catch (e: any) {
      this.logger.error(`Instagram webhook processing error for user ${userId}: ${e.message}`);
    }

    res.status(200).type('text/plain').send('OK');
  }

  private signatureIsValid(req: Request, appSecret: string | null, userId: number): boolean {
    if (!appSecret) {
      this.logger.warn(
        `Instagram webhook received without app_secret configured; signature not verified (user ${userId})`,
      );
      return true;
    }
    const raw = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.api.verifyWebhookSignature(
      raw,
      req.header('X-Hub-Signature-256') ?? undefined,
      appSecret,
    );
  }
}
