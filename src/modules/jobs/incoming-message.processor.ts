import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from '../billing/billing.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';
import { CareerIncomingHandler } from '../career/career-incoming.handler';
import { UserStateService } from '../workflows/user-state.service';
import {
  buildPublishedWorkflowWhere,
  messageMatchesBookingIntent,
  selectWorkflowForBusiness,
} from '../workflows/incoming-workflow-matcher';
import { normalizeWhatsAppPhone } from '../workflows/nodes/booking-node.helpers';

const INTERACTIVE_PAUSE_NODE_TYPES = new Set([
  'pick_options',
  'list_resources',
  'list_slots',
  'interactive_message',
]);

/** Matches workflows for inbound messages and starts or resumes executions. */
@Injectable()
export class IncomingMessageProcessor {
  private readonly logger = new Logger(IncomingMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly billing: BillingService,
    private readonly careerIncoming: CareerIncomingHandler,
    private readonly userStateService: UserStateService,
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
      this.logger.warn(
        `Skipping message ${messageId}: tenant ${message.userId} has no platform access`,
      );
      return;
    }

    const metadata = (message.metadata as Record<string, any>) ?? {};
    if (metadata.from_bot) {
      return;
    }

    if (await this.careerIncoming.tryHandle(messageId)) {
      return;
    }

    const content = String(message.content ?? '');
    const messageChannel = message.contact.channel || 'whatsapp';

    const waiting = await this.prisma.workflowExecution.findFirst({
      where: {
        userId: message.userId,
        contactId: message.contactId,
        status: 'waiting',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (waiting) {
      const restarted = await this.maybeRestartStuckBooking(waiting, message, content);
      if (!restarted) {
        const handled = await this.resumeWaitingExecution(waiting, message, content);
        if (handled) {
          return;
        }
      }
    }

    const businessCategory = await this.settings.get(message.userId, 'business_category');
    const workflows = await this.prisma.workflow.findMany({
      where: buildPublishedWorkflowWhere(message.userId, businessCategory) as any,
    });

    const workflow = selectWorkflowForBusiness(
      workflows,
      content,
      messageChannel,
      businessCategory,
    );

    if (!workflow) {
      this.logger.warn(
        `No auto-reply matched for tenant ${message.userId} message="${content.slice(0, 80)}" ` +
          `(business=${businessCategory ?? 'none'}, published=${workflows.length})`,
      );
      return;
    }

    this.logger.log(
      `Starting workflow ${workflow.id} (${workflow.name}) for tenant ${message.userId}`,
    );

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

  /** Cancel a stale interactive booking when the customer texts a fresh booking keyword. */
  private async maybeRestartStuckBooking(
    waiting: { id: number; workflowId: number; context: unknown },
    message: { userId: number; contact: { phone: string | null } },
    content: string,
  ): Promise<boolean> {
    if (!messageMatchesBookingIntent(content)) {
      return false;
    }

    const ctx = (waiting.context as Record<string, unknown>) ?? {};
    const pausedNodeId = ctx.__paused_at_node_id as string | undefined;
    if (!pausedNodeId) {
      return false;
    }

    const wf = await this.prisma.workflow.findUnique({ where: { id: waiting.workflowId } });
    const def = (wf?.definition as { nodes?: { id: string; type: string }[] }) ?? {};
    const pausedNode = def.nodes?.find((n) => n.id === pausedNodeId);
    if (!pausedNode || !INTERACTIVE_PAUSE_NODE_TYPES.has(pausedNode.type)) {
      return false;
    }

    await this.prisma.workflowExecution.update({
      where: { id: waiting.id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: 'Restarted — customer sent a new booking message',
      },
    });

    const phone = normalizeWhatsAppPhone(message.contact.phone);
    if (phone) {
      await this.userStateService.clearUserState(message.userId, phone);
    }

    this.logger.log(
      `Restarting booking for tenant ${message.userId}: cancelled waiting execution ${waiting.id}`,
    );
    return true;
  }

  private async resumeWaitingExecution(
    waiting: {
      id: number;
      workflowId: number;
      conversationId: number | null;
      context: unknown;
    },
    message: {
      id: number;
      userId: number;
      conversationId: number;
      content: string | null;
      contact: { channel: string; username: string | null };
    },
    content: string,
  ): Promise<boolean> {
    const ctx = (waiting.context as Record<string, any>) ?? {};
    const pausedNodeId = ctx.__paused_at_node_id as string | undefined;

    if (pausedNodeId) {
      const wf = await this.prisma.workflow.findUnique({ where: { id: waiting.workflowId } });
      const def = (wf?.definition as { nodes?: { id: string; type: string }[] }) ?? {};
      const pausedNode = def.nodes?.find((n) => n.id === pausedNodeId);

      if (pausedNode && INTERACTIVE_PAUSE_NODE_TYPES.has(pausedNode.type)) {
        const conversationId = waiting.conversationId ?? message.conversationId;
        if (conversationId) {
          await this.queue.enqueueSendMessage({
            userId: message.userId,
            conversationId,
            content:
              'Please tap one of the buttons in our last message to continue your booking. ' +
              'Or send *book* to start a fresh booking.',
          });
        }
        return true;
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
    return true;
  }
}
