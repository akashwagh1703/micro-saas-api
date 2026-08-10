import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { CatalogOrdersService } from '../../catalog/catalog-orders.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import { resolveContactPhone } from './booking-node.helpers';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Creates a CatalogOrder (qty=1) from context.catalog_product_id and loads payment QR into context.
 */
@Injectable()
export class CreateCatalogOrderNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(CreateCatalogOrderNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: CatalogOrdersService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const productId = Number(context.catalog_product_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      await this.sendText(execution, 'Please pick a product from the catalog to order.');
      return {
        success: true,
        stop: true,
        output: { catalog_order_error: 'missing_product' },
      };
    }

    const phone = await resolveContactPhone(this.prisma, execution, context);
    const contactName =
      String(context.contact_name ?? '').trim() ||
      (execution.contactId
        ? (
            await this.prisma.contact.findUnique({
              where: { id: execution.contactId },
              select: { name: true },
            })
          )?.name?.trim()
        : null) ||
      null;

    try {
      const { order } = await this.orders.create(execution.userId, {
        product_id: productId,
        customer_phone: phone,
        customer_name: contactName,
        contact_id: execution.contactId ?? null,
        conversation_id: execution.conversationId ?? null,
        workflow_execution_id: execution.id,
        notes: context.catalog_website_order
          ? 'Website catalog order'
          : 'WhatsApp catalog order',
      });

      const payment = await this.orders.resolvePaymentQrUrl(execution.userId);
      if (!payment.configured || !payment.url) {
        await this.sendText(
          execution,
          'Sorry — online payment is not available right now. Please try again later or message us directly.',
        );
        return {
          success: true,
          stop: true,
          output: { catalog_order_error: 'payments_not_configured', catalog_order_id: order.id },
        };
      }

      const upiBits = [
        payment.upi_vpa ? `UPI: ${payment.upi_vpa}` : '',
        payment.upi_payee_name ? `Payee: ${payment.upi_payee_name}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        success: true,
        output: {
          catalog_order_id: order.id,
          catalog_order_number: order.order_number,
          catalog_order_amount: String(order.amount_inr),
          catalog_order_product_name: order.product_name,
          catalog_payment_qr_url: payment.url,
          catalog_payment_upi_line: upiBits,
          catalog_product_offset: 0,
        },
      };
    } catch (error: any) {
      const msg = extractErrorMessage(error);
      this.logger.warn(`create_catalog_order failed: ${msg}`);
      await this.sendText(
        execution,
        msg.includes('out of stock')
          ? 'Sorry — that product is out of stock. Browse the catalog again for available items.'
          : msg.toLowerCase().includes('payment')
            ? 'Sorry — online payment is not available right now. Please try again later.'
            : 'Sorry — we could not create that order. Please try again from the catalog.',
      );
      return {
        success: true,
        stop: true,
        output: { catalog_order_error: msg || 'create_failed' },
      };
    }
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

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const err = error as { message?: string; getResponse?: () => unknown };
  if (typeof err.getResponse === 'function') {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      const m = (res as { message?: string | string[] }).message;
      if (Array.isArray(m)) return m.join(' ');
      if (typeof m === 'string') return m;
    }
  }
  return String(err.message ?? '');
}
