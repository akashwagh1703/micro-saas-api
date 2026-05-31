import { Inject, Injectable } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from '../billing/billing.service';
import { workflowHasTriggerKeywords } from '../workflows/business-workflow';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';

/** Ports ProcessIncomingWhatsAppMessage: matches workflows and fans out executions. */
@Injectable()
export class IncomingMessageProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly billing: BillingService,
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
    const matching = workflows.filter((w) => this.triggerMatches(w, content));
    const keywordWorkflows = matching.filter((w) =>
      workflowHasTriggerKeywords(w.definition),
    );
    const catchAllWorkflows = matching.filter(
      (w) => !workflowHasTriggerKeywords(w.definition),
    );
    const toRun = keywordWorkflows.length > 0 ? keywordWorkflows : catchAllWorkflows;

    for (const workflow of toRun) {
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
  }

  private triggerMatches(workflow: Workflow, messageText: string): boolean {
    const definition = (workflow.definition as { nodes?: any[] }) ?? {};
    const trigger = (definition.nodes ?? []).find((n) => n.type === 'trigger');
    const data = trigger?.data ?? {};

    const raw = data.keywords ?? '';
    const keywords = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((k: any) => String(k).trim())
      .filter((k: string) => k.length > 0);

    if (keywords.length === 0) {
      return true;
    }

    const match = data.match ?? 'any';
    const haystack = messageText.toLowerCase();

    const hits = keywords.filter((k: string) =>
      match === 'exact' ? haystack === k.toLowerCase() : haystack.includes(k.toLowerCase()),
    );

    return match === 'all' ? hits.length === keywords.length : hits.length > 0;
  }
}
