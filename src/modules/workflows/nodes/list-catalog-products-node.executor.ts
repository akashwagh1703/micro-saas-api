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

const OTHER_CATEGORY_ID = 0;

/**
 * WhatsApp catalog browse: products in selected category, 5/page.
 * Requires context.catalog_category_id (0 = uncategorized / Other).
 * Pagination: context.catalog_product_offset
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
      const categoriesNodeId = String(data.categories_node_id ?? 'list-catalog-categories');
      const selfNodeId = String(node.id);

      const rawCategoryId = context.catalog_category_id;
      if (rawCategoryId == null || rawCategoryId === '') {
        const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
          name: `wf-${execution.id}-${node.id}-pick-cat`,
          header: 'Catalog',
          body: 'Please choose a *category* first to see products.',
          items: [
            {
              optionText: 'Categories',
              description: 'Browse by category',
              displayOrder: 0,
              nextNodeId: categoriesNodeId,
              metadata: {
                catalog_action: 'categories',
                catalog_category_offset: 0,
                catalog_product_offset: 0,
              },
            },
            {
              optionText: 'Main Menu',
              description: 'Back to start',
              displayOrder: 1,
              nextNodeId: mainMenuNodeId,
              metadata: { catalog_action: 'main_menu' },
            },
          ],
          useButtons: true,
        });
        return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
          catalog_redirect_to_categories: true,
          catalog_product_offset: 0,
        });
      }

      const categoryId = Number(rawCategoryId);
      let categoryName = String(context.catalog_category_name || '').trim();
      if (!categoryName) {
        if (categoryId === OTHER_CATEGORY_ID) {
          categoryName = 'Other';
        } else {
          const cat = await this.prisma.catalogCategory.findFirst({
            where: { id: categoryId, siteId: site.id },
            select: { name: true },
          });
          categoryName = cat?.name || 'Products';
        }
      }

      let offset = Number(context.catalog_product_offset ?? 0);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const products = await this.prisma.catalogProduct.findMany({
        where: {
          siteId: site.id,
          isActive: true,
          ...(categoryId === OTHER_CATEGORY_ID
            ? { categoryId: null }
            : { categoryId }),
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { image: true },
      });

      if (!products.length) {
        const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
          name: `wf-${execution.id}-${node.id}-empty`,
          header: truncate(categoryName, 60),
          body: `No products in *${categoryName}* right now.\n\nPick another category or return to the main menu.`,
          items: [
            {
              optionText: 'Categories',
              description: 'Browse other categories',
              displayOrder: 0,
              nextNodeId: categoriesNodeId,
              metadata: {
                catalog_action: 'categories',
                catalog_category_offset: 0,
                catalog_product_offset: 0,
              },
            },
            {
              optionText: 'Main Menu',
              description: 'Back to start',
              displayOrder: 1,
              nextNodeId: mainMenuNodeId,
              metadata: { catalog_action: 'main_menu', catalog_product_offset: 0 },
            },
          ],
          useButtons: true,
        });
        return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
          catalog_products_offered: 0,
          catalog_product_offset: 0,
          catalog_category_id: categoryId,
          catalog_category_name: categoryName,
        });
      }

      let pageProducts = products.slice(offset, offset + pageSize);
      if (!pageProducts.length) {
        offset = 0;
        pageProducts = products.slice(0, pageSize);
      }
      const hasMore = offset + pageSize < products.length;

      for (const product of pageProducts) {
        await this.sendProductCard(execution, product);
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
          description: truncate(`${formatPrice(product)} · In stock`, 72),
          displayOrder: displayOrder++,
          nextNodeId: createOrderNodeId,
          metadata: {
            catalog_action: 'order',
            catalog_product_id: product.id,
            catalog_category_id: categoryId,
            catalog_category_name: categoryName,
            context_field: 'catalog_product_id',
            context_value: product.id,
          },
        });
      }

      if (hasMore) {
        items.push({
          optionText: 'More Products',
          description: 'Next products in this category',
          displayOrder: displayOrder++,
          nextNodeId: selfNodeId,
          metadata: {
            catalog_action: 'more',
            catalog_product_offset: offset + pageSize,
            catalog_category_id: categoryId,
            catalog_category_name: categoryName,
            context_field: 'catalog_product_offset',
            context_value: offset + pageSize,
          },
        });
      }

      // Keep nav rows within WhatsApp's 10-row list limit
      const navBudget = Math.max(0, 10 - items.length);
      const nav: typeof items = [
        {
          optionText: 'Main Menu',
          description: 'Back to start',
          displayOrder: displayOrder++,
          nextNodeId: mainMenuNodeId,
          metadata: {
            catalog_action: 'main_menu',
            catalog_product_offset: 0,
            catalog_category_offset: 0,
            context_field: 'catalog_product_offset',
            context_value: 0,
          },
        },
        {
          optionText: 'Categories',
          description: 'Pick another category',
          displayOrder: displayOrder++,
          nextNodeId: categoriesNodeId,
          metadata: {
            catalog_action: 'categories',
            catalog_category_offset: 0,
            catalog_product_offset: 0,
            catalog_category_id: null,
            context_field: 'catalog_category_offset',
            context_value: 0,
          },
        },
        {
          optionText: 'Catalog',
          description: 'Shop from the start',
          displayOrder: displayOrder++,
          nextNodeId: categoriesNodeId,
          metadata: {
            catalog_action: 'catalog',
            catalog_category_offset: 0,
            catalog_product_offset: 0,
            catalog_category_id: null,
            context_field: 'catalog_category_offset',
            context_value: 0,
          },
        },
      ];
      items.push(...nav.slice(0, navBudget));

      const capped = items.slice(0, 10);
      const pageLabel = String(Math.floor(offset / pageSize) + 1);
      const body = hasMore
        ? `*${categoryName}* — page ${pageLabel}\n\nProducts are listed above.\nTap *Order* for an in-stock item, or *More Products* to continue.`
        : `*${categoryName}*\n\nProducts are listed above.\nTap *Order* for an in-stock item, or use the menu below.`;

      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-p${offset}-c${categoryId}`,
        header: data.header
          ? substituteContext(String(data.header), {
              ...context,
              catalog_category_name: categoryName,
            })
          : truncate(categoryName, 60),
        body: data.body
          ? substituteContext(String(data.body), {
              ...context,
              catalog_category_name: categoryName,
              catalog_page_label: pageLabel,
            })
          : body,
        footer: data.footer ? substituteContext(String(data.footer), context) : undefined,
        items: capped,
        useButtons: capped.length <= 3,
      });

      return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
        catalog_products_offered: pageProducts.length,
        catalog_product_offset: offset,
        catalog_has_more: hasMore,
        catalog_category_id: categoryId,
        catalog_category_name: categoryName,
      });
    } catch (error: any) {
      this.logger.error(`list_catalog_products failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async sendProductCard(
    execution: WorkflowExecution,
    product: CatalogProduct & { image: { id: number; url?: string | null } | null },
  ): Promise<void> {
    if (!execution.conversationId) return;

    const price = formatPrice(product);
    const shortDesc = product.description?.trim()
      ? truncate(product.description.trim(), 120)
      : '';
    const stockQty = product.stockQuantity ?? 0;
    const stockLine = stockQty > 0 ? '' : 'Out of stock';
    const caption = [`*${product.name}*`, price, shortDesc, stockLine]
      .filter(Boolean)
      .join('\n');

    // Prefer signed URL so images work even when the brochure site is still draft.
    const imageUrl = this.resolveProductImageUrl(execution.userId, product);

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
      this.logger.warn(
        `Product image send failed for product ${product.id}: ${result.error ?? 'unknown'}`,
      );
    }

    await this.jobs.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: caption,
    });
  }

  private resolveProductImageUrl(
    userId: number,
    product: CatalogProduct & { image: { id: number; url?: string | null } | null },
  ): string {
    const mediaId = product.imageMediaId ?? product.image?.id ?? null;
    if (mediaId == null) return '';

    try {
      return this.share.buildSignedUrl(mediaId, userId, 72);
    } catch (error: any) {
      this.logger.warn(`Signed product image URL failed (${mediaId}): ${error?.message}`);
    }

    const stored = String(product.image?.url || '').trim();
    if (/^https?:\/\//i.test(stored)) return stored;

    return this.share.buildPublicMediaUrl(mediaId);
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
