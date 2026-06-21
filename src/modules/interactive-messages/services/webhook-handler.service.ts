import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsAppWebhookPayload, WebhookMessage, InteractiveReply } from '../dto/webhook-payload.dto';

export interface ButtonClickData {
  optionId: number;
  phoneNumber: string;
  templateId?: number;
  nextNodeId?: string;
  responseTime?: number;
}

export interface WebhookProcessingResult {
  success: boolean;
  optionId?: number;
  nextNodeId?: string;
  error?: string;
}

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Handle incoming interactive webhook response
   */
  async handleInteractiveResponse(payload: WhatsAppWebhookPayload): Promise<WebhookProcessingResult> {
    try {
      this.logger.debug('Received interactive webhook payload');

      // Extract message from webhook
      const message = this.extractMessage(payload);
      if (!message) {
        throw new BadRequestException('No message found in webhook payload');
      }

      // Parse button or list reply
      const buttonData = this.parseInteractiveReply(message);
      if (!buttonData) {
        throw new BadRequestException('No interactive reply found in message');
      }

      this.logger.log(`Processing interactive reply from ${buttonData.phoneNumber}, optionId: ${buttonData.optionId}`);

      // Validate option exists
      const option = await this.validateOption(buttonData.optionId);
      if (!option) {
        throw new NotFoundException(`Option ${buttonData.optionId} not found`);
      }

      this.logger.debug(`Option found: ${option.id}, next node: ${option.nextNodeId}`);

      // Route to next workflow node
      if (option.nextNodeId) {
        // TODO: Implement routing to workflow execution service
        // await this.workflowExecution.executeNode(
        //   workflowId,
        //   option.nextNodeId,
        //   buttonData.phoneNumber
        // );

        this.logger.log(`Routing to next node: ${option.nextNodeId}`);
      }

      // Track analytics
      await this.trackButtonClick(
        option.id,
        buttonData.phoneNumber,
        option.template?.id,
        buttonData.responseTime,
      );

      return {
        success: true,
        optionId: option.id,
        nextNodeId: option.nextNodeId || undefined,
      };
    } catch (error) {
      this.logger.error('Error processing interactive webhook:', error);
      throw error;
    }
  }

  /**
   * Extract message from webhook payload
   */
  private extractMessage(payload: WhatsAppWebhookPayload): WebhookMessage | null {
    try {
      const entry = payload.entry?.[0];
      if (!entry) return null;

      const change = entry.changes?.[0];
      if (!change) return null;

      const messages = change.value?.messages;
      if (!messages || messages.length === 0) return null;

      // Find interactive message
      const interactiveMessage = messages.find((msg) => msg.type === 'interactive');
      return interactiveMessage || null;
    } catch (error) {
      this.logger.error('Failed to extract message from payload:', error);
      return null;
    }
  }

  /**
   * Parse interactive reply (button or list)
   */
  private parseInteractiveReply(message: WebhookMessage): ButtonClickData | null {
    try {
      if (!message.interactive) {
        return null;
      }

      const interactive = message.interactive;
      let optionId: number | null = null;

      // Parse button reply
      if (interactive.type === 'button_reply' && interactive.button_reply?.id) {
        optionId = parseInt(interactive.button_reply.id, 10);
        this.logger.debug(`Parsed button reply: ${optionId}`);
      }

      // Parse list reply
      if (interactive.type === 'list_reply' && interactive.list_reply?.id) {
        optionId = parseInt(interactive.list_reply.id, 10);
        this.logger.debug(`Parsed list reply: ${optionId}`);
      }

      if (optionId === null || isNaN(optionId)) {
        this.logger.warn(`Could not parse option ID from interactive reply`);
        return null;
      }

      return {
        optionId,
        phoneNumber: message.from,
      };
    } catch (error) {
      this.logger.error('Failed to parse interactive reply:', error);
      return null;
    }
  }

  /**
   * Validate option exists in database
   */
  private async validateOption(optionId: number): Promise<any> {
    try {
      const option = await this.prisma.interactiveMessageOption.findUnique({
        where: { id: optionId },
        include: {
          template: {
            include: {
              messageType: true,
            },
          },
        },
      });

      if (!option) {
        this.logger.warn(`Option ${optionId} not found`);
        return null;
      }

      // Validate option has a template
      if (!option.template) {
        this.logger.warn(`Option ${optionId} has no associated template`);
        return null;
      }

      return option;
    } catch (error) {
      this.logger.error(`Failed to validate option ${optionId}:`, error);
      return null;
    }
  }

  /**
   * Track button click in analytics
   */
  private async trackButtonClick(
    optionId: number,
    phoneNumber: string,
    templateId?: number,
    responseTime?: number,
  ): Promise<void> {
    try {
      // TODO: Implement analytics tracking when analytics service is ready
      // await this.analytics.trackButtonClick({
      //   optionId,
      //   phoneNumber,
      //   templateId,
      //   responseTime,
      //   timestamp: new Date(),
      // });

      this.logger.log(`Tracked button click: option ${optionId} from ${phoneNumber}`);
    } catch (error) {
      this.logger.error('Failed to track button click:', error);
      // Don't throw - analytics failure shouldn't break the flow
    }
  }

  /**
   * Parse button reply from webhook (helper)
   */
  parseButtonReply(payload: WhatsAppWebhookPayload): { optionId: number; phoneNumber: string } | null {
    const message = this.extractMessage(payload);
    if (!message || !message.interactive?.button_reply) {
      return null;
    }

    const optionId = parseInt(message.interactive.button_reply.id, 10);
    if (isNaN(optionId)) {
      return null;
    }

    return {
      optionId,
      phoneNumber: message.from,
    };
  }

  /**
   * Parse list reply from webhook (helper)
   */
  parseListReply(payload: WhatsAppWebhookPayload): { optionId: number; phoneNumber: string } | null {
    const message = this.extractMessage(payload);
    if (!message || !message.interactive?.list_reply) {
      return null;
    }

    const optionId = parseInt(message.interactive.list_reply.id, 10);
    if (isNaN(optionId)) {
      return null;
    }

    return {
      optionId,
      phoneNumber: message.from,
    };
  }

  /**
   * Route to next workflow node
   */
  async routeToNextNode(workflowId: string, nextNodeId: string, phoneNumber: string): Promise<void> {
    try {
      this.logger.log(
        `Routing conversation to next node - Workflow: ${workflowId}, Node: ${nextNodeId}, Phone: ${phoneNumber}`,
      );

      // TODO: Implement routing to workflow execution service
      // await this.workflowExecution.executeNode(workflowId, nextNodeId, phoneNumber);

      this.logger.log(`Successfully routed to next node`);
    } catch (error) {
      this.logger.error('Failed to route to next node:', error);
      throw error;
    }
  }

  /**
   * Get option details with full context
   */
  async getOptionDetails(optionId: number): Promise<any> {
    try {
      return await this.prisma.interactiveMessageOption.findUnique({
        where: { id: optionId },
        include: {
          template: {
            include: {
              messageType: true,
              workflowNodes: true,
            },
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to get option details for ${optionId}:`, error);
      return null;
    }
  }

  /**
   * Verify user state before processing webhook
   */
  async verifyUserState(phoneNumber: string, expectedWorkflowId?: string): Promise<boolean> {
    try {
      // TODO: Implement user state verification when user state service is ready
      // const userState = await this.userState.getState(phoneNumber);
      // if (!userState) {
      //   this.logger.warn(`No user state found for ${phoneNumber}`);
      //   return false;
      // }

      // if (userState.status !== 'WAITING_FOR_RESPONSE') {
      //   this.logger.warn(`User ${phoneNumber} not in WAITING_FOR_RESPONSE state`);
      //   return false;
      // }

      // if (expectedWorkflowId && userState.workflowId !== expectedWorkflowId) {
      //   this.logger.warn(`User state workflow mismatch for ${phoneNumber}`);
      //   return false;
      // }

      this.logger.debug(`User state verified for ${phoneNumber}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to verify user state:', error);
      return false;
    }
  }

  /**
   * Update user state after webhook processing
   */
  async updateUserState(phoneNumber: string, workflowId: string, nextNodeId: string): Promise<void> {
    try {
      // TODO: Implement user state update when user state service is ready
      // await this.userState.setState(phoneNumber, {
      //   workflowId,
      //   currentNodeId: nextNodeId,
      //   status: 'PROCESSING',
      //   lastInteractionAt: new Date(),
      // });

      this.logger.debug(`Updated user state for ${phoneNumber} to node ${nextNodeId}`);
    } catch (error) {
      this.logger.error('Failed to update user state:', error);
      // Don't throw - state update failure shouldn't break the flow
    }
  }
}
