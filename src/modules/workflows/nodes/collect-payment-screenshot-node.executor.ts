import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecution } from '@prisma/client';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogOrdersService } from '../../catalog/catalog-orders.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { NodeExecutor, NodeExecutionResult } from './node-executor.interface';
import { substituteContext } from './booking-node.helpers';

/**
 * After QR is sent: ask for UPI payment screenshot, pause, then attach on inbound image.
 */
@Injectable()
export class CollectPaymentScreenshotNodeExecutor implements NodeExecutor {
  private readonly logger = new Logger(CollectPaymentScreenshotNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: CatalogOrdersService,
    private readonly whatsappApi: WhatsAppApiService,
    private readonly crypto: CryptoService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  async execute(
    execution: WorkflowExecution,
    node: Record<string, any>,
    context: Record<string, any>,
  ): Promise<NodeExecutionResult> {
    const data = node.data ?? {};
    const orderId = Number(context.catalog_order_id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return { success: false, error: 'collect_payment_screenshot requires catalog_order_id' };
    }

    const alreadyAttached = context.catalog_payment_screenshot_attached === true;
    if (alreadyAttached) {
      return { success: true, output: {} };
    }

    // Resume after customer reply
    if (context.__resuming) {
      const mediaId = String(context.__inbound_wa_image_id ?? '').trim();
      if (!mediaId) {
        await this.sendText(
          execution,
          String(
            data.retry_message ??
              'Please send a *photo/screenshot* of your UPI payment (an image), not a text message.',
          ),
        );
        return {
          success: true,
          pause: true,
          stop: true,
          output: {
            __paused_at_node_id: node.id,
            waiting_for: 'payment_screenshot',
          },
        };
      }

      try {
        const creds = await this.getWhatsAppCreds(execution.userId);
        if (!creds) {
          return { success: false, error: 'WhatsApp is not connected — cannot download screenshot' };
        }

        const downloaded = await this.whatsappApi.downloadMedia(creds.accessToken, mediaId);
        if (!downloaded.success || !downloaded.buffer?.length) {
          await this.sendText(
            execution,
            'We could not download that image. Please send the payment screenshot again.',
          );
          return {
            success: true,
            pause: true,
            stop: true,
            output: {
              __paused_at_node_id: node.id,
              waiting_for: 'payment_screenshot',
              __inbound_wa_image_id: '',
            },
          };
        }

        await this.orders.attachScreenshotFromBuffer(execution.userId, orderId, {
          buffer: downloaded.buffer,
          mimetype: downloaded.mimeType || String(context.__inbound_wa_image_mime || 'image/jpeg'),
          originalname: `wa-payment-${orderId}.jpg`,
        });

        return {
          success: true,
          output: {
            catalog_payment_screenshot_attached: true,
            __inbound_wa_image_id: '',
            __inbound_wa_image_mime: '',
            __resuming: false,
          },
        };
      } catch (error: any) {
        this.logger.warn(`Payment screenshot attach failed: ${error.message}`);
        await this.sendText(
          execution,
          'We could not save that screenshot. Please send a clear image of your payment and try again.',
        );
        return {
          success: true,
          pause: true,
          stop: true,
          output: {
            __paused_at_node_id: node.id,
            waiting_for: 'payment_screenshot',
            __inbound_wa_image_id: '',
          },
        };
      }
    }

    // First visit — ask for screenshot
    if (!execution.conversationId) {
      return { success: false, error: 'No conversation for payment screenshot', stop: true };
    }

    const question = substituteContext(
      String(
        data.question ??
          '📸 Please send a *screenshot* of your UPI payment for order *{{catalog_order_number}}* (*{{catalog_order_product_name}}* · ₹{{catalog_order_amount}}).\n\nWe will verify it shortly — you will get a confirmation message once approved.',
      ),
      context,
    );

    await this.jobs.enqueueSendMessage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      content: question,
    });

    return {
      success: true,
      pause: true,
      stop: true,
      output: {
        __paused_at_node_id: node.id,
        waiting_for: 'payment_screenshot',
        question_sent: question,
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

  private async getWhatsAppCreds(
    userId: number,
  ): Promise<{ accessToken: string; phoneNumberId: string } | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account?.isConnected || !account.accessToken || !account.phoneNumberId) return null;
    const accessToken = this.crypto.decrypt(account.accessToken);
    if (!accessToken) return null;
    return { accessToken, phoneNumberId: account.phoneNumberId };
  }
}
