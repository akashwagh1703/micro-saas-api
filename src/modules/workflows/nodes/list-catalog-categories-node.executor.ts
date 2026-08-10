import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CATALOG_WA_CATEGORIES_PER_PAGE } from '../../catalog/catalog-order.constants';
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
 * WhatsApp catalog browse: pick a category (paginate if >8), then products.
 * Pagination cursor: context.catalog_category_offset
 */
@Injectable()
export class ListCatalogCategoriesNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(ListCatalogCategoriesNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
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
        return { success: false, error: 'No contact phone number for catalog categories' };
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
        Math.max(Number(data.page_size) || CATALOG_WA_CATEGORIES_PER_PAGE, 1),
        8,
      );
      const productsNodeId = String(data.products_node_id ?? 'list-catalog-products');
      const mainMenuNodeId = String(data.main_menu_node_id ?? 'pick-menu');
      const selfNodeId = String(node.id);

      let offset = Number(context.catalog_category_offset ?? 0);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const categories = await this.prisma.catalogCategory.findMany({
        where: { siteId: site.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      const productGroups = await this.prisma.catalogProduct.groupBy({
        by: ['categoryId'],
        where: { siteId: site.id, isActive: true },
        _count: { _all: true },
      });
      const countByCategory = new Map<number | null, number>();
      for (const row of productGroups) {
        countByCategory.set(row.categoryId, row._count._all);
      }
      const uncategorizedCount = countByCategory.get(null) ?? 0;

      type BrowseCategory = {
        id: number;
        name: string;
        description: string | null;
        count: number;
      };

      const offered: BrowseCategory[] = categories
        .map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          count: countByCategory.get(c.id) ?? 0,
        }))
        .filter((c) => c.count > 0);

      if (uncategorizedCount > 0) {
        offered.push({
          id: OTHER_CATEGORY_ID,
          name: 'Other',
          description: 'More products',
          count: uncategorizedCount,
        });
      }

      if (!offered.length) {
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
              optionText: 'Main Menu',
              description: 'Back to start',
              displayOrder: 0,
              nextNodeId: mainMenuNodeId,
              metadata: {
                catalog_action: 'main_menu',
                catalog_category_offset: 0,
                catalog_product_offset: 0,
              },
            },
          ],
          useButtons: true,
        });
        return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
          catalog_categories_offered: 0,
          catalog_category_offset: 0,
          catalog_product_offset: 0,
          catalog_category_id: null,
        });
      }

      let page = offered.slice(offset, offset + pageSize);
      if (!page.length) {
        offset = 0;
        page = offered.slice(0, pageSize);
      }
      const hasMore = offset + pageSize < offered.length;

      const items: Array<{
        optionText: string;
        description?: string;
        displayOrder: number;
        nextNodeId: string;
        metadata?: Record<string, unknown>;
      }> = [];

      let displayOrder = 0;
      for (const category of page) {
        items.push({
          optionText: truncate(category.name, 20),
          description: truncate(
            category.description?.trim() || `${category.count} product${category.count === 1 ? '' : 's'}`,
            72,
          ),
          displayOrder: displayOrder++,
          nextNodeId: productsNodeId,
          metadata: {
            catalog_action: 'pick_category',
            catalog_category_id: category.id,
            catalog_category_name: category.name,
            catalog_product_offset: 0,
            context_field: 'catalog_category_id',
            context_value: category.id,
          },
        });
      }

      if (hasMore) {
        items.push({
          optionText: 'More Categories',
          description: 'See the next page',
          displayOrder: displayOrder++,
          nextNodeId: selfNodeId,
          metadata: {
            catalog_action: 'more_categories',
            catalog_category_offset: offset + pageSize,
            context_field: 'catalog_category_offset',
            context_value: offset + pageSize,
          },
        });
      }

      items.push({
        optionText: 'Main Menu',
        description: 'Back to start',
        displayOrder: displayOrder++,
        nextNodeId: mainMenuNodeId,
        metadata: {
          catalog_action: 'main_menu',
          catalog_category_offset: 0,
          catalog_product_offset: 0,
          context_field: 'catalog_category_offset',
          context_value: 0,
        },
      });

      const capped = items.slice(0, 10);
      const pageLabel = String(Math.floor(offset / pageSize) + 1);
      const body = hasMore
        ? substituteContext(
            String(
              data.body ??
                'Choose a *category* to browse products.\n\nPage {{catalog_category_page}} — tap *More Categories* for the rest.',
            ),
            { ...context, catalog_category_page: pageLabel },
          )
        : substituteContext(
            String(
              data.end_body ??
                'Choose a *category* to see products, prices, and order options.',
            ),
            context,
          );

      const template = await createDynamicInteractiveTemplate(this.prisma, execution.userId, {
        name: `wf-${execution.id}-${node.id}-p${offset}`,
        header: data.header ? substituteContext(String(data.header), context) : 'Catalog',
        body,
        footer: data.footer ? substituteContext(String(data.footer), context) : undefined,
        items: capped,
        useButtons: capped.length <= 3,
      });

      return this.deliverAndPause(execution, contactPhone, node.id, template.id, {
        catalog_categories_offered: page.length,
        catalog_category_offset: offset,
        catalog_has_more_categories: hasMore,
        catalog_product_offset: 0,
        catalog_category_id: null,
        catalog_category_name: null,
      });
    } catch (error: any) {
      this.logger.error(`list_catalog_categories failed: ${error.message}`);
      return { success: false, error: error.message };
    }
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
      return { success: false, error: delivered.error ?? 'Failed to send category picker' };
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
