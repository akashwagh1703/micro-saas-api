import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import {
  WhatsAppMessagePayload,
  InteractiveMessage,
  QuickReplyAction,
  ListAction,
  FlowButtonAction,
  WhatsAppApiResponse,
  WhatsAppApiError,
} from '../dto/whatsapp-payload.dto';

export interface SendInteractiveResult {
  messageId: string;
  status: string;
  timestamp: string;
}

export interface ApiErrorClassification {
  retryable: boolean;
  type: 'RATE_LIMIT' | 'NETWORK' | 'VALIDATION' | 'AUTH' | 'SERVER' | 'UNKNOWN';
  statusCode?: number;
  reason: string;
}

@Injectable()
export class WhatsAppApiService {
  private readonly logger = new Logger(WhatsAppApiService.name);
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
  ) {
    this.baseUrl = config.get<string>('WHATSAPP_API_URL', 'https://graph.facebook.com');
    this.apiVersion = config.get<string>('WHATSAPP_VERSION', 'v18.0');
  }

  /**
   * Send interactive message via WhatsApp Business API
   */
  async sendInteractiveMessage(phoneNumber: string, template: any): Promise<SendInteractiveResult> {
    try {
      this.logger.debug(`Preparing to send interactive message to ${phoneNumber}`);

      // Validate phone number format
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new BadRequestException(`Invalid phone number format: ${phoneNumber}`);
      }

      // Build the payload
      const payload = this.buildInteractivePayload(phoneNumber, template);
      this.logger.debug(`Payload built for ${phoneNumber}`);

      // Make API call
      const result = await this.makeApiCall(payload);

      // Extract message ID from response
      const messageId = result.messages?.[0]?.id;
      if (!messageId) {
        throw new InternalServerErrorException('No message ID in API response');
      }

      this.logger.log(`Message sent successfully to ${phoneNumber}, ID: ${messageId}`);

      return {
        messageId,
        status: 'sent',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to send message to ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Build WhatsApp interactive message payload
   */
  private buildInteractivePayload(phoneNumber: string, template: any): WhatsAppMessagePayload {
    const messageType = template.messageType || 'QUICK_REPLY';

    const payload: WhatsAppMessagePayload = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: messageType === 'QUICK_REPLY' ? 'button' : messageType === 'LIST_MESSAGE' ? 'list' : 'button',
        body: {
          text: template.bodyText,
        },
        action: this.buildAction(template),
      } as InteractiveMessage,
    };

    // Add optional header
    if (template.headerText) {
      payload.interactive.header = {
        type: 'text',
        text: template.headerText,
      };
    }

    // Add optional footer
    if (template.footerText) {
      payload.interactive.footer = {
        text: template.footerText,
      };
    }

    this.logger.debug(`Built payload for messageType: ${messageType}`);
    return payload;
  }

  /**
   * Build action based on message type
   */
  private buildAction(template: any): QuickReplyAction | ListAction | FlowButtonAction {
    const messageType = template.messageType || 'QUICK_REPLY';

    switch (messageType) {
      case 'QUICK_REPLY':
        return this.buildQuickReplyAction(template.options);

      case 'LIST_MESSAGE':
        return this.buildListAction(template.options);

      case 'FLOW_BUTTON':
        return this.buildFlowButtonAction(template.options);

      default:
        throw new BadRequestException(`Unknown message type: ${messageType}`);
    }
  }

  /**
   * Build quick reply action (max 3 buttons)
   */
  private buildQuickReplyAction(options: any[]): QuickReplyAction {
    if (!options || options.length === 0) {
      throw new BadRequestException('Quick reply must have at least 1 option');
    }

    if (options.length > 3) {
      throw new BadRequestException('Quick reply can have maximum 3 options');
    }

    return {
      buttons: options.map((opt, index) => ({
        type: 'reply',
        reply: {
          id: String(opt.id || index),
          title: opt.optionText.substring(0, 20), // Max 20 chars
        },
      })),
    };
  }

  /**
   * Build list action (max 10 items)
   */
  private buildListAction(options: any[]): ListAction {
    if (!options || options.length === 0) {
      throw new BadRequestException('List message must have at least 1 option');
    }

    if (options.length > 10) {
      throw new BadRequestException('List message can have maximum 10 options');
    }

    return {
      button: 'View Options',
      sections: [
        {
          rows: options.map((opt, index) => ({
            id: String(opt.id || index),
            title: opt.optionText.substring(0, 24), // Max 24 chars
            description: opt.description?.substring(0, 72) || undefined, // Max 72 chars
          })),
        },
      ],
    };
  }

  /**
   * Build flow button action (single button)
   */
  private buildFlowButtonAction(options: any[]): FlowButtonAction {
    if (!options || options.length === 0) {
      throw new BadRequestException('Flow button must have 1 option');
    }

    const option = options[0];
    const url = option.metadata?.url;

    if (!url) {
      throw new BadRequestException('Flow button option must have URL in metadata');
    }

    return {
      button: option.optionText.substring(0, 20),
      url: url,
    };
  }

  /**
   * Make actual API call to WhatsApp
   */
  private async makeApiCall(payload: WhatsAppMessagePayload): Promise<WhatsAppApiResponse> {
    try {
      // Note: This is a placeholder - actual implementation requires:
      // 1. Getting WhatsApp credentials (accessToken, phoneNumberId)
      // 2. Making axios POST request
      // For now, we'll mock this behavior

      this.logger.debug(`Making API call to WhatsApp with payload`, JSON.stringify(payload));

      // TODO: Implement actual axios call
      // const credentials = await this.whatsapp.credentials(userId);
      // if (!credentials?.accessToken) {
      //   throw new BadRequestException('WhatsApp credentials not configured');
      // }

      // const response = await axios.post(
      //   `${this.baseUrl}/${this.apiVersion}/${credentials.phoneNumberId}/messages`,
      //   payload,
      //   {
      //     headers: {
      //       'Authorization': `Bearer ${credentials.accessToken}`,
      //       'Content-Type': 'application/json',
      //     },
      //     timeout: 30000,
      //   }
      // );

      // For implementation, this would be:
      // return response.data as WhatsAppApiResponse;

      // Placeholder return - remove when implementing
      return {
        messages: [{ id: 'wamid_' + Date.now() }],
        contacts: [{ input: payload.to, wa_id: payload.to.replace(/\D/g, '') }],
      };
    } catch (error) {
      this.logger.error('API call failed:', error);
      throw error;
    }
  }

  /**
   * Handle and classify API errors
   */
  async handleApiError(error: any, phoneNumber: string, template: any): Promise<ApiErrorClassification> {
    const statusCode = error.response?.status || error.code;
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';

    this.logger.warn(`API error for ${phoneNumber}: ${statusCode} - ${errorMessage}`);

    const classification = this.classifyError(statusCode, errorMessage);

    return {
      ...classification,
      statusCode,
      reason: errorMessage,
    };
  }

  /**
   * Classify error type and determine if retryable
   */
  private classifyError(statusCode: number, errorMessage: string): Omit<ApiErrorClassification, 'statusCode' | 'reason'> {
    // Rate limiting - retryable
    if (statusCode === 429) {
      return {
        retryable: true,
        type: 'RATE_LIMIT',
      };
    }

    // Validation errors - not retryable
    if (statusCode === 400) {
      return {
        retryable: false,
        type: 'VALIDATION',
      };
    }

    // Authentication errors - not retryable
    if (statusCode === 401 || statusCode === 403) {
      return {
        retryable: false,
        type: 'AUTH',
      };
    }

    // Server errors - retryable
    if (statusCode >= 500 && statusCode < 600) {
      return {
        retryable: true,
        type: 'SERVER',
      };
    }

    // Network timeouts - retryable
    if (statusCode === 408 || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      return {
        retryable: true,
        type: 'NETWORK',
      };
    }

    // Other errors
    return {
      retryable: false,
      type: 'UNKNOWN',
    };
  }

  /**
   * Validate phone number format
   */
  private validatePhoneNumber(phoneNumber: string): boolean {
    // E.164 format: + followed by 1-15 digits
    const regex = /^\+?[1-9]\d{1,14}$/;
    return regex.test(phoneNumber);
  }
}
