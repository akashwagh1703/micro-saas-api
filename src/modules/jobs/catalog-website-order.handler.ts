import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseWebsiteCatalogOrderProductId } from '../catalog/catalog-website-order.util';
import { isCatalogCommerceWorkflowDefinitionCurrent } from '../workflows/catalog-commerce-workflow';
import { normalizeWhatsAppPhone } from '../workflows/nodes/booking-node.helpers';
import { UserStateService } from '../workflows/user-state.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';

type IncomingMessage = {
  id: number;
  userId: number;
  contactId: number;
  conversationId: number;
  content: string | null;
  contact: {
    channel: string;
    phone: string | null;
    name: string | null;
    username: string | null;
  };
};

/**
 * Website Order button → WhatsApp deep link.
 * Detects AW_PRODUCT_ID buy messages and starts catalog checkout at create-catalog-order.
 */
@Injectable()
export class CatalogWebsiteOrderHandler {
  private readonly logger = new Logger(CatalogWebsiteOrderHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userStateService: UserStateService,
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
  ) {}

  async tryHandle(message: IncomingMessage): Promise<boolean> {
    const content = String(message.content ?? '');
    const productId = parseWebsiteCatalogOrderProductId(content);
    if (!productId) return false;

    const workflow = await this.findCatalogCommerceWorkflow(message.userId);
    if (!workflow) {
      this.logger.warn(
        `Website order product ${productId}: no catalog commerce workflow for user ${message.userId}`,
      );
      return false;
    }

    const product = await this.prisma.catalogProduct.findFirst({
      where: {
        id: productId,
        isActive: true,
        site: { userId: message.userId },
      },
      select: { id: true, name: true, stockQuantity: true },
    });
    if (!product) {
      await this.queue.enqueueSendMessage({
        userId: message.userId,
        conversationId: message.conversationId,
        content:
          'Sorry — that product is no longer available. Please browse the catalog again or reply *Hi* for the menu.',
      });
      return true;
    }

    if ((product.stockQuantity ?? 0) <= 0) {
      await this.queue.enqueueSendMessage({
        userId: message.userId,
        conversationId: message.conversationId,
        content: `Sorry — *${product.name}* is currently out of stock. Please pick another product from the website or WhatsApp catalog.`,
      });
      return true;
    }

    await this.cancelWaitingInteractive(message);

    const execution = await this.prisma.workflowExecution.create({
      data: {
        userId: message.userId,
        workflowId: workflow.id,
        contactId: message.contactId,
        conversationId: message.conversationId,
        messageId: message.id,
        status: 'pending',
        context: {
          message: content,
          channel: message.contact.channel,
          contact_phone: message.contact.phone ?? '',
          contact_name: message.contact.name ?? '',
          contact_username: message.contact.username ?? '',
          catalog_product_id: product.id,
          catalog_website_order: true,
          __collected: {},
          __resuming: true,
          __resume_at_node_id: 'create-catalog-order',
        },
      },
    });

    this.logger.log(
      `Website order → checkout execution ${execution.id} product=${product.id} user=${message.userId}`,
    );
    await this.queue.enqueueExecuteWorkflow(execution.id);
    return true;
  }

  private async findCatalogCommerceWorkflow(userId: number) {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        userId,
        status: 'published',
        isActive: true,
        isArchived: false,
        OR: [{ useCase: 'catalog_share' }, { businessCategory: 'catalog' }],
      },
      orderBy: { updatedAt: 'desc' },
    });

    for (const wf of workflows) {
      const def = wf.definition as { nodes?: unknown[]; edges?: unknown[] } | null;
      if (isCatalogCommerceWorkflowDefinitionCurrent(def as any)) {
        return wf;
      }
      const nodes = (def?.nodes ?? []) as Array<{ id?: string; type?: string }>;
      if (
        nodes.some((n) => n.id === 'create-catalog-order') &&
        nodes.some((n) => n.type === 'create_catalog_order')
      ) {
        return wf;
      }
    }
    return null;
  }

  private async cancelWaitingInteractive(message: IncomingMessage): Promise<void> {
    const waiting = await this.prisma.workflowExecution.findFirst({
      where: {
        userId: message.userId,
        contactId: message.contactId,
        status: 'waiting',
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!waiting) return;

    await this.prisma.workflowExecution.update({
      where: { id: waiting.id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: 'Restarted — customer ordered from website',
      },
    });

    const phone = normalizeWhatsAppPhone(message.contact.phone);
    if (phone) {
      await this.userStateService.clearUserState(message.userId, phone);
    }
  }
}
