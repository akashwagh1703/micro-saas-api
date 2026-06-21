import { Injectable, Logger, Inject, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';
import { WhatsAppApiService, ApiErrorClassification } from './whatsapp-api.service';
import axios from 'axios';

export interface InteractiveMessageJob {
  userId: number;
  phoneNumber: string;
  templateId: number;
  workflowId: string;
  nodeId: string;
}

export interface JobProcessingResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
}

@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);

  private readonly retryAttempts: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly fallbackEnabled: boolean;
  private readonly fallbackText: string;

  constructor(
    @Inject(JOB_DISPATCHER) private readonly queue: JobDispatcher,
    private readonly whatsapp: WhatsAppApiService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.retryAttempts = config.get<number>('MESSAGE_RETRY_ATTEMPTS', 3);
    this.retryInitialDelayMs = config.get<number>('MESSAGE_RETRY_INITIAL_DELAY_MS', 2000);
    this.retryMaxDelayMs = config.get<number>('MESSAGE_RETRY_MAX_DELAY_MS', 30000);
    this.fallbackEnabled = config.get<boolean>('MESSAGE_FALLBACK_ENABLED', true);
    this.fallbackText = config.get<string>(
      'MESSAGE_FALLBACK_TEXT',
      'Sorry, your message could not be sent. Please try again.',
    );
  }

  /**
   * Queue an interactive message for sending
   */
  async queueInteractiveMessage(jobData: InteractiveMessageJob): Promise<string> {
    try {
      this.logger.log(`Queueing interactive message for ${jobData.phoneNumber}, template: ${jobData.templateId}`);

      // Validate input
      this.validateJobData(jobData);

      // Enqueue job with retry configuration
      const jobId = await this.queue.enqueueSendInteractiveMessage({
        ...jobData,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });

      this.logger.log(`Message queued with jobId: ${jobId}`);
      return jobId;
    } catch (error) {
      this.logger.error('Failed to queue message:', error);
      throw error;
    }
  }

  /**
   * Process send interactive message job (called by pgboss)
   */
  async processSendInteractive(job: any): Promise<JobProcessingResult> {
    const { userId, phoneNumber, templateId, workflowId, nodeId, attempts = 0 } = job.data;

    this.logger.log(
      `Processing interactive message job (attempt ${attempts + 1}/${this.retryAttempts}): ${phoneNumber}`,
    );

    try {
      // Get template from database
      const template = await this.prisma.interactiveMessageTemplate.findUnique({
        where: { id: templateId },
        include: {
          options: { orderBy: { displayOrder: 'asc' } },
          messageType: true,
        },
      });

      if (!template) {
        throw new BadRequestException(`Template ${templateId} not found`);
      }

      // Attempt to send via WhatsApp API
      const result = await this.whatsapp.sendInteractiveMessage(phoneNumber, template);

      // Success - update job status and return
      this.logger.log(`Message sent successfully to ${phoneNumber}, ID: ${result.messageId}`);

      // Track in analytics if needed
      await this.trackMessageSent(userId, templateId, phoneNumber, result.messageId, workflowId);

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      // Handle error
      return await this.handleMessageSendError(error, job, phoneNumber, templateId, userId, workflowId);
    }
  }

  /**
   * Handle message sending errors
   */
  private async handleMessageSendError(
    error: any,
    job: any,
    phoneNumber: string,
    templateId: number,
    userId: number,
    workflowId: string,
  ): Promise<JobProcessingResult> {
    const attempts = (job.data.attempts || 0) + 1;

    this.logger.warn(`Message send failed for ${phoneNumber}, attempt ${attempts}/${this.retryAttempts}`);

    try {
      // Classify the error
      const classification = await this.whatsapp.handleApiError(error, phoneNumber, {});

      // If retryable and attempts remaining, throw to trigger pgboss retry
      if (classification.retryable && attempts < this.retryAttempts) {
        this.logger.log(`Retryable error for ${phoneNumber}, will retry (${attempts}/${this.retryAttempts})`);
        throw error; // pgboss will automatically retry with backoff
      }

      // Non-retryable or max attempts reached - send fallback
      if (this.fallbackEnabled) {
        this.logger.log(`Sending fallback message to ${phoneNumber}`);
        await this.sendFallbackMessage(phoneNumber, userId);
      }

      // Log failed attempt
      await this.trackMessageFailed(userId, templateId, phoneNumber, error.message, workflowId);

      return {
        success: false,
        error: error.message,
        retryable: false,
      };
    } catch (fallbackError) {
      this.logger.error('Error during fallback or error handling:', fallbackError);

      // Track failed attempt
      await this.trackMessageFailed(userId, templateId, phoneNumber, fallbackError.message, workflowId).catch(
        (trackError) => this.logger.error('Failed to track message failure:', trackError),
      );

      // Still throw so pgboss knows the job failed
      if (classification && classification.retryable && attempts < this.retryAttempts) {
        throw error;
      }

      return {
        success: false,
        error: fallbackError.message,
        retryable: false,
      };
    }
  }

  /**
   * Send fallback text message to user
   */
  private async sendFallbackMessage(phoneNumber: string, userId: number): Promise<void> {
    try {
      this.logger.log(`Sending fallback text message to ${phoneNumber}`);

      // Get WhatsApp credentials
      const credentials = await this.getWhatsAppCredentials(userId);
      if (!credentials) {
        throw new BadRequestException('WhatsApp credentials not configured');
      }

      // Send text message via WhatsApp API
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: this.fallbackText,
        },
      };

      // TODO: Implement actual axios call to WhatsApp API
      // const response = await axios.post(
      //   `${this.config.get('WHATSAPP_API_URL')}/v18.0/${credentials.phoneNumberId}/messages`,
      //   payload,
      //   {
      //     headers: {
      //       'Authorization': `Bearer ${credentials.accessToken}`,
      //       'Content-Type': 'application/json',
      //     },
      //   }
      // );

      this.logger.log(`Fallback message sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send fallback message to ${phoneNumber}:`, error);
      // Don't throw - fallback failure shouldn't break the main flow
    }
  }

  /**
   * Get retry configuration for pgboss
   */
  private getRetryConfig() {
    return {
      attempts: this.retryAttempts,
      backoff: {
        type: 'exponential',
        delay: this.retryInitialDelayMs,
      },
    };
  }

  /**
   * Get job status from queue
   */
  async getJobStatus(jobId: string): Promise<{ status: string; attempts?: number; error?: string }> {
    try {
      // TODO: Implement actual pgboss job status retrieval
      // const job = await this.queue.getJob(jobId);
      // return {
      //   status: job.state,
      //   attempts: job.attempt,
      //   error: job.err?.message,
      // };

      this.logger.debug(`Getting status for job ${jobId}`);
      return {
        status: 'unknown',
        attempts: 0,
      };
    } catch (error) {
      this.logger.error('Failed to get job status:', error);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Validate job data before queueing
   */
  private validateJobData(jobData: InteractiveMessageJob): void {
    if (!jobData.userId) {
      throw new BadRequestException('userId is required');
    }
    if (!jobData.phoneNumber || !this.validatePhoneNumber(jobData.phoneNumber)) {
      throw new BadRequestException('Valid phoneNumber is required');
    }
    if (!jobData.templateId) {
      throw new BadRequestException('templateId is required');
    }
    if (!jobData.workflowId) {
      throw new BadRequestException('workflowId is required');
    }
  }

  /**
   * Validate phone number format
   */
  private validatePhoneNumber(phoneNumber: string): boolean {
    const regex = /^\+?[1-9]\d{1,14}$/;
    return regex.test(phoneNumber);
  }

  /**
   * Get WhatsApp credentials for user
   */
  private async getWhatsAppCredentials(userId: number): Promise<any> {
    try {
      const account = await this.prisma.whatsAppAccount.findUnique({
        where: { userId },
      });

      if (!account || !account.accessToken || !account.phoneNumberId) {
        return null;
      }

      // In production, decrypt the access token
      // For now, return as-is
      return {
        accessToken: account.accessToken,
        phoneNumberId: account.phoneNumberId,
      };
    } catch (error) {
      this.logger.error('Failed to get WhatsApp credentials:', error);
      return null;
    }
  }

  /**
   * Track successful message sending in analytics
   */
  private async trackMessageSent(
    userId: number,
    templateId: number,
    phoneNumber: string,
    messageId: string,
    workflowId: string,
  ): Promise<void> {
    try {
      // TODO: Implement analytics tracking when analytics service is ready
      // await this.analytics.trackMessageSent({
      //   userId,
      //   templateId,
      //   phoneNumber,
      //   messageId,
      //   workflowId,
      //   timestamp: new Date(),
      // });

      this.logger.debug(`Tracked message sent: ${messageId}`);
    } catch (error) {
      this.logger.error('Failed to track message:', error);
      // Don't throw - analytics failure shouldn't break the flow
    }
  }

  /**
   * Track failed message sending in analytics
   */
  private async trackMessageFailed(
    userId: number,
    templateId: number,
    phoneNumber: string,
    error: string,
    workflowId: string,
  ): Promise<void> {
    try {
      // TODO: Implement analytics tracking when analytics service is ready
      // await this.analytics.trackMessageFailed({
      //   userId,
      //   templateId,
      //   phoneNumber,
      //   error,
      //   workflowId,
      //   timestamp: new Date(),
      // });

      this.logger.debug(`Tracked message failed: ${error}`);
    } catch (error) {
      this.logger.error('Failed to track message failure:', error);
      // Don't throw
    }
  }
}
