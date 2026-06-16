import { Inject, Injectable } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from '../billing/billing.service';
import { triggerChannelMatches } from '../workflows/workflow-trigger-channel';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { CareerIncomingHandler } from '../career/career-incoming.handler';

/** Ports ProcessIncomingWhatsAppMessage: matches workflows and fans out executions. */
@Injectable()
export class IncomingMessageProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly billing: BillingService,
    private readonly careerIncoming: CareerIncomingHandler,
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
  ) {}

  async handle(messageId: number): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true, conversation: true },
    });

    if (!message || message.direction !== 'incoming') {
      return;
    }

    if (!(await this.billing.hasPlatformAccess(message.userId))) {
      return;
    }

    const metadata = (message.metadata as Record<string, any>) ?? {};
    if (metadata.from_bot) {
      return;
    }

    if (await this.careerIncoming.tryHandle(messageId)) {
      return;
    }

    // Phase 3: resume a paused (Ask & Wait) workflow before starting new ones.
    const waiting = await this.prisma.workflowExecution.findFirst({
      where: {
        userId: message.userId,
        contactId: message.contactId,
        status: 'waiting',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (waiting) {
      const ctx = (waiting.context as Record<string, any>) ?? {};
      await this.prisma.workflowExecution.update({
        where: { id: waiting.id },
        data: {
          status: 'pending',
          messageId: message.id,
          context: {
            ...ctx,
            message: message.content,
            channel: message.contact.channel,
            contact_username: message.contact.username ?? '',
            __resuming: true,
          },
        },
      });
      await this.queue.enqueueExecuteWorkflow(waiting.id);
      return;
    }

    const businessCategory = await this.settings.get(message.userId, 'business_category');
    const workflows = await this.prisma.workflow.findMany({
      where: {
        userId: message.userId,
        status: 'published',
        isActive: true,
        isArchived: false,
        triggerType: 'message_received',
        ...(businessCategory ? { businessCategory } : {}),
      },
    });

    const content = String(message.content);
    const messageChannel = message.contact.channel || 'whatsapp';
    const workflow = this.selectWorkflow(workflows, content, messageChannel);
    if (!workflow) {
      return;
    }

    const execution = await this.prisma.workflowExecution.create({
      data: {
        userId: message.userId,
        workflowId: workflow.id,
        contactId: message.contactId,
        conversationId: message.conversationId,
        messageId: message.id,
        status: 'pending',
        context: {
          message: message.content,
          channel: message.contact.channel,
          contact_phone: message.contact.phone ?? '',
          contact_name: message.contact.name,
          contact_username: message.contact.username ?? '',
          __collected: {},
        },
      },
    });

    await this.queue.enqueueExecuteWorkflow(execution.id);
  }

  /**
   * Pick a single workflow to run for an inbound message. Keyword-specific
   * workflows win over catch-all ones; among keyword matches the most specific
   * (most keyword hits) wins, with the most recently updated as the tie-break.
   * Returns null when nothing matches. Running exactly one workflow prevents
   * duplicate / conflicting replies.
   */
  private selectWorkflow(
    workflows: Workflow[],
    content: string,
    channel: string,
  ): Workflow | null {
    const matching = workflows
      .map((w) => ({ workflow: w, hits: this.triggerHitCount(w, content, channel) }))
      .filter((m) => m.hits !== null) as { workflow: Workflow; hits: number }[];

    if (matching.length === 0) {
      return null;
    }

    const keyword = matching.filter((m) => m.hits > 0);
    const pool = keyword.length > 0 ? keyword : matching;

    pool.sort((a, b) => {
      if (b.hits !== a.hits) {
        return b.hits - a.hits;
      }
      return this.updatedAtMs(b.workflow) - this.updatedAtMs(a.workflow);
    });

    return pool[0].workflow;
  }

  private updatedAtMs(workflow: Workflow): number {
    return workflow.updatedAt ? new Date(workflow.updatedAt).getTime() : 0;
  }

  /**
   * Returns the number of keyword hits for a matching workflow, `0` for a
   * matching catch-all (no keywords) workflow, or `null` when the workflow does
   * not match this message at all.
   */
  private triggerHitCount(
    workflow: Workflow,
    messageText: string,
    messageChannel: string,
  ): number | null {
    const definition = (workflow.definition as { nodes?: any[] }) ?? {};
    const trigger = (definition.nodes ?? []).find((n) => n.type === 'trigger');
    const data = trigger?.data ?? {};

    if (!triggerChannelMatches(data, messageChannel)) {
      return null;
    }

    const raw = data.keywords ?? '';
    const keywords = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((k: any) => String(k).trim())
      .filter((k: string) => k.length > 0);

    if (keywords.length === 0) {
      return 0;
    }

    const match = data.match ?? 'any';
    const haystack = messageText.toLowerCase();

    const hits = keywords.filter((k: string) =>
      match === 'exact' ? haystack === k.toLowerCase() : haystack.includes(k.toLowerCase()),
    );

    if (match === 'all') {
      return hits.length === keywords.length ? hits.length : null;
    }

    return hits.length > 0 ? hits.length : null;
  }
}
