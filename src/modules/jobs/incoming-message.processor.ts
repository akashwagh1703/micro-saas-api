import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from '../billing/billing.service';
import { selectWorkflowForMessage } from '../workflows/workflow-selection.util';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { CareerIncomingHandler } from '../career/career-incoming.handler';

const INTERACTIVE_PAUSE_NODE_TYPES = new Set([
  'pick_options',
  'list_resources',
  'list_slots',
  'interactive_message',
]);

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
      const pausedNodeId = ctx.__paused_at_node_id as string | undefined;

      if (pausedNodeId) {
        const wf = await this.prisma.workflow.findUnique({ where: { id: waiting.workflowId } });
        const def = (wf?.definition as { nodes?: { id: string; type: string }[] }) ?? {};
        const pausedNode = def.nodes?.find((n) => n.id === pausedNodeId);
        if (pausedNode && INTERACTIVE_PAUSE_NODE_TYPES.has(pausedNode.type)) {
          if (waiting.conversationId) {
            await this.queue.enqueueSendMessage({
              userId: message.userId,
              conversationId: waiting.conversationId,
              content:
                'Please tap one of the buttons in our last message to continue your booking. No need to type — just select an option.',
            });
          }
          return;
        }
      }

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
    const workflow = selectWorkflowForMessage(workflows, content, messageChannel);
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
}
