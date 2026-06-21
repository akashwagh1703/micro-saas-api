import { Controller, Post, Body, Logger } from '@nestjs/common';
import { InteractiveMessageHandlerService } from './interactive-message-handler.service';

/**
 * Interactive Message Webhook Controller
 * Receives button clicks and list selections from WhatsApp webhook
 * Routes responses back to workflows
 */
@Controller('webhooks/interactive')
export class InteractiveMessageWebhookController {
  private readonly logger = new Logger(InteractiveMessageWebhookController.name);

  constructor(
    private readonly handler: InteractiveMessageHandlerService,
  ) {}

  /**
   * Handle interactive message response from WhatsApp
   * Receives button clicks and list selections
   */
  @Post('response')
  async handleInteractiveResponse(@Body() payload: any) {
    try {
      const phoneNumber = payload.from || payload.phoneNumber;
      const optionId = 
        payload.interactive?.button_reply?.id ||
        payload.interactive?.list_reply?.id ||
        payload.selectedOptionId;

      if (!phoneNumber) {
        this.logger.warn('No phone number in interactive response');
        return { success: false, message: 'Phone number required' };
      }

      if (!optionId) {
        this.logger.warn('No option ID in interactive response');
        return { success: false, message: 'Option ID required' };
      }

      // Convert optionId to number if it's a string
      const optionIdNum = typeof optionId === 'string' ? parseInt(optionId, 10) : optionId;

      // Handle the button response and resume workflow
      const result = await this.handler.handleButtonResponse(
        phoneNumber,
        optionIdNum,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Error in interactive webhook: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Webhook endpoint specifically for WhatsApp Business API interactive responses
   * Matches the webhook format from WhatsApp
   */
  @Post('whatsapp')
  async handleWhatsAppInteractiveResponse(@Body() payload: any) {
    try {
      const { entry } = payload;

      if (!Array.isArray(entry)) {
        return { success: false };
      }

      const results: any[] = [];

      for (const e of entry) {
        if (!e.changes) continue;

        for (const change of e.changes) {
          const { value } = change;
          if (!value?.messages) continue;

          for (const message of value.messages) {
            if (message.type !== 'interactive') continue;

            const phoneNumber = message.from;
            const optionId =
              message.interactive?.button_reply?.id ||
              message.interactive?.list_reply?.id;

            if (phoneNumber && optionId) {
              // Convert optionId to number if it's a string
              const optionIdNum = typeof optionId === 'string' ? parseInt(optionId, 10) : optionId;
              const result = await this.handler.handleButtonResponse(
                phoneNumber,
                optionIdNum,
              );
              results.push(result);
            }
          }
        }
      }

      return { success: true, processed: results.length };
    } catch (error: any) {
      this.logger.error(
        `Error in WhatsApp interactive webhook: ${error.message}`,
      );
      return { success: false, message: error.message };
    }
  }
}
