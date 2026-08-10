import { Inject, Injectable, Logger } from '@nestjs/common';
import { CatalogProduct, WorkflowExecution } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogShareService } from '../../catalog/catalog-share.service';
import { CATALOG_WA_PRODUCTS_PER_PAGE } from '../../catalog/catalog-order.constants';
import { InboxService } from '../../inbox/inbox.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { UserStateService } from '../user-state.service';
import { WorkflowInteractiveSendService } from '../workflow-interactive-send.service';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import {
  createDynamicInteractiveTemplate,
  resolveContactPhone,
  substituteContext,
} from './booking-node.helpers';

/**
 * WhatsApp catalog browse (Phase 4): active products, 5/page, Order only if in stock.
 * Pagination cursor: context.catalog_product_offset
 */
@Injectable()
export class ListCatalogProductsNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(ListCatalogProductsNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly share: CatalogShareService,
    private readonly inbox: InboxService,
    private readonly userStateService: UserStateService,
    private readonly interactiveSend: WorkflowInteractiveSendService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    try {
      const data = node.data ?? {};
      const contactPhone = await resolveContactPhone(this.prisma, execution, context);
      if (!contactPhone) {
        return { success: false, error: 'No contact phone number for catalog browse' };
      }

      const site = await this.prisma.catalogSite.findUnique({
        where: { userId: execution.userId },
      });
      if (!site) {
        await this.sendText(
          execution,
          'Our product catalog is not set up yet. Please try again later.',
        );
        return { success: true, pause: true, output: { catalog_empty: true } };
      }

      const pageSize = Math.min(
        Math.max(Number(data.page_size) || CATALOG_WA_PRODUCTS_PER_PAGE, 1),
        5,
      );
      const createOrderNodeId = String(data.create_order_node_id ?? 'create-catalog-order');
      const mainMenuNodeId = String(data.main_menu_node_id ?? 'pick-menu');
      const selfNodeId = String(node.id);

      let offset = Number(context.catalog_product_offset ?? 0);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const products = await this.prisma.catalogProduct.findMany({
        where: { siteId: site.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { image: true },
      });

      if (!products.length) {
        const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
          name: `wf-${execution.id}-${node.id}-empty`,
          header: 'Catalog',
          body: substituteContext(
            String(
              data.empty_message ??
                'No products are listed yet for *{{catalog_business_name}}*.\n\nTap below to return to the main menu.',
            ),
            context,
          ),
          items: [
            {
              optionText: '🏠 Main Menu',
              description: 'Back to start',
              displayOrder: 0,
              nextNodeId: mainMenuNodeId,
              metadata: { catalog_action: 'main_menu', catalog_product_offset: 0 },
            },
          ],
          useButtons: true,
        });
        return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
          catalog_products_offered: 0,
          catalog_product_offset: 0,
        });
      }

      const page = products.slice(offset, offset + pageSize);
      if (!page.length) {
        // Cursor past end — restart from 0
        offset = 0;
      }
      const pageProducts = products.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < products.length;
      const isLastPage = !hasMore;

      for (const product of pageProducts) {
        await this.sendProductCard(execution, site.status === 'published', product);
      }

      const items: Array<{
        optionText: string;
        description?: string;
        displayOrder: number;
        nextNodeId: string;
        metadata?: Record<string, unknown>;
      }> = [];

      let displayOrder = 0;
      for (const product of pageProducts) {
        const inStock = (product.stockQuantity ?? 0) > 0;
        if (!inStock) continue;
        const shortName = truncate(product.name, 14);
        items.push({
          optionText: truncate(`Order ${shortName}`, 20),
          description: truncate(
            `${formatPrice(product)} · In stock`,
            72,
          ),
          displayOrder: displayOrder++,
          nextNodeId: createOrderNodeId,
          metadata: {
            catalog_action: 'order',
            catalog_product_id: product.id,
            context_field: 'catalog_product_id',
            context_value: product.id,
          },
        });
      }

      if (hasMore) {
        items.push({
          optionText: '➡️ More Products',
          description: 'See the next page',
          displayOrder: displayOrder++,
          nextNodeId: selfNodeId,
          metadata: {
            catalog_action: 'more',
            catalog_product_offset: offset + pageSize,
            context_field: 'catalog_product_offset',
            context_value: offset + pageSize,
          },
        });
      }

      items.push({
        optionText: '🏠 Main Menu',
        description: 'Back to start',
        displayOrder: displayOrder++,
        nextNodeId: mainMenuNodeId,
        metadata: {
          catalog_action: 'main_menu',
          catalog_product_offset: 0,
          context_field: 'catalog_product_offset',
          context_value: 0,
        },
      });

      if (isLastPage) {
        items.push({
          optionText: '🔄 View Catalog',
          description: 'Browse from the start',
          displayOrder: displayOrder++,
          nextNodeId: selfNodeId,
          metadata: {
            catalog_action: 'restart',
            catalog_product_offset: 0,
            context_field: 'catalog_product_offset',
            context_value: 0,
          },
        });
      }

      // WhatsApp list max 10 rows
      const capped = items.slice(0, 10);
      const body = isLastPage
        ? substituteContext(
            String(
              data.end_body ??
                'That’s the end of our catalog for *{{catalog_business_name}}*.\n\nTap a product to order, or use the menu below.',
            ),
            context,
          )
        : substituteContext(
            String(
              data.body ??
                '🛍️ *Catalog* — page {{catalog_page_label}}\n\nTap *Order* on an in-stock item, or *More Products* to continue.',
            ),
            {
              ...context,
              catalog_page_label: `${Math.floor(offset / pageSize) + 1}`,
            },
          );

      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-p${offset}`,
        header: data.header ? substituteContext(String(data.header), context) : '🛍️ Catalog',
        body,
        footer: data.footer ? substituteContext(String(data.footer), context) : undefined,
        items: capped,
        useButtons: capped.length <= 3,
      });

      return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
        catalog_products_offered: pageProducts.length,
        catalog_product_offset: offset,
        catalog_has_more: hasMore,
      });
    } catch (error: any) {
      this.logger.error(`list_catalog_products failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async sendProductCard(
    execution: WorkflowExecution,
    published: boolean,
    product: CatalogProduct & { image: { id: number } | null },
  ): Promise<void> {
    if (!execution.conversationId) return;

    const stockQty = product.stockQuantity ?? 0;
    const stockLabel = stockQty > 0 ? '✅ In Stock' : '❌ Out of Stock';
    const price = formatPrice(product);
    const caption = [
      `*${product.name}*`,
      price,
      stockLabel,
      product.description?.trim() ? product.description.trim().slice(0, 120) : '',
    ]
      .filter(Boolean)
      .join('\n');

    let imageUrl = '';
    if (product.imageMediaId) {
      if (published) {
        imageUrl = this.share.buildPublicMediaUrl(product.imageMediaId);
      } else {
        try {
          imageUrl = this.share.buildSignedUrl(product.imageMediaId, execution.userId, 72);
        } catch {
          imageUrl = this.share.buildPublicMediaUrl(product.imageMediaId);
        }
      }
    }

    if (imageUrl) {
      const result = await this.inbox.sendOutgoingImageByLink(
        execution.userId,
        execution.conversationId,
        imageUrl,
        caption,
        {
          source: 'workflow_list_catalog_products',
          workflowId: execution.workflowId,
          nodeId: `product-${product.id}`,
        },
      );
      if (result.success) return;
    }

    await this.jobs.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: caption,
    });
  }

  private async deliverAndPause(
    execution: WorkflowExecution,
    contactPhone: string,
    nodeId: string,
    templateId: number,
    output: Record<string, unknown>,
  ): Promise<NodeExecutionResult> {
    const delivered = await this.interactiveSend.deliverTemplate({
      execution,
      contactPhone,
      templateId,
      nodeId,
    });
    if (!delivered.success) {
      return { success: false, error: delivered.error ?? 'Failed to send catalog picker' };
    }

    await this.userStateService.saveUserState(
      execution.userId,
      contactPhone,
      execution.workflowId,
      nodeId,
      String(templateId),
      'WAITING_FOR_RESPONSE',
    );

    return {
      success: true,
      pause: true,
      output: {
        ...output,
        template_id: templateId,
      },
    };
  }

  private async sendText(execution: WorkflowExecution, content: string): Promise<void> {
    if (!execution.conversationId) return;
    await this.jobs.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content,
    });
  }
}

function truncate(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function formatPrice(product: { priceAmount: unknown; priceCurrency: string }): string {
  if (product.priceAmount == null || product.priceAmount === '') return 'Price on request';
  const amount = Number(product.priceAmount);
  if (!Number.isFinite(amount)) return 'Price on request';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: product.priceCurrency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
}
