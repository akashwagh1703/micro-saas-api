import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserStateService } from './user-state.service';
import { JOB_DISPATCHER, JobDispatcher } from '../queue/job-dispatcher';

/**
 * Interactive Message Handler Service
 * Processes button clicks and list selections from users
 * Routes to next workflow nodes based on selected options
 */
@Injectable()
export class InteractiveMessageHandlerService {
  private readonly logger = new Logger(InteractiveMessageHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userStateService: UserStateService,
    @Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher,
  ) {}

  /**
   * Handle a button click or list selection from a user
   * Resumes the workflow at the configured next node
   */
  async handleButtonResponse(
    phoneNumber: string,
    optionId: number,
  ): Promise<{
    success: boolean;
    message?: string;
    workflowId?: number;
    nextNodeId?: string;
  }> {
    try {
      // Get user state
      const userState = await this.userStateService.getUserState(phoneNumber);

      if (!userState) {
        return {
          success: false,
          message: 'No active workflow for this user',
        };
      }

      if (userState.status !== 'WAITING_FOR_RESPONSE') {
        this.logger.warn(
          `User ${phoneNumber} not waiting for response (status=${userState.status})`,
        );
        return {
          success: false,
          message: 'User is not waiting for a response',
        };
      }

      const templateId = this.userStateService.getTemplateIdFromState(userState);
      if (!templateId) {
        return {
          success: false,
          message: 'No template associated with user state',
        };
      }

      // Get the option that was selected
      const option = await this.prisma.interactiveMessageOption.findUnique({
        where: { id: optionId },
      });

      if (!option) {
        return {
          success: false,
          message: `Option not found (id=${optionId})`,
        };
      }

      // Verify option belongs to the template - match type
      const templateIdFromState = this.userStateService.getTemplateIdFromState(userState);
      const templateIdNum = typeof templateIdFromState === 'string' 
        ? parseInt(templateIdFromState, 10) 
        : templateIdFromState;
      
      if (!templateIdNum || templateIdNum !== option.templateId) {
        return {
          success: false,
          message: 'Option does not match current template',
        };
      }

      // Get the next node ID from the option
      const nextNodeId = option.nextNodeId;
      if (!nextNodeId) {
        this.logger.warn(
          `Option ${optionId} has no next node routing configured`,
        );
        // Clear state but don't error - workflow just ends
        await this.userStateService.clearUserState(phoneNumber);
        return {
          success: true,
          message: 'No next node configured - workflow ends',
        };
      }

      // Save the user's selection
      await this.saveUserSelection(phoneNumber, optionId);

      // Get the current workflow execution (if exists)
      const execution = await this.prisma.workflowExecution.findFirst({
        where: {
          workflowId: userState.workflowId,
          status: 'waiting',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!execution) {
        // No active execution - clear state
        await this.userStateService.clearUserState(phoneNumber);
        return {
          success: true,
          message: 'No active execution found - cleared state',
        };
      }

      // Resume the workflow from the next node
      const resumed = await this.resumeWorkflowAtNode(
        execution.id,
        nextNodeId,
        phoneNumber,
        String(optionId),
      );

      if (!resumed) {
        return {
          success: false,
          message: 'Failed to resume workflow',
        };
      }

      // Clear state after successful resume
      await this.userStateService.clearUserState(phoneNumber);

      return {
        success: true,
        workflowId: userState.workflowId,
        nextNodeId,
      };
    } catch (error: any) {
      this.logger.error(
        `Error handling button response: ${error.message}`,
      );
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Resume a workflow execution at a specific node
   * Called after user selects an option
   */
  private async resumeWorkflowAtNode(
    executionId: number,
    nextNodeId: string,
    phoneNumber: string,
    selectedOptionId: string,
  ): Promise<boolean> {
    try {
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return false;
      }

      // Update execution context with user selection
      const context = (execution.context as Record<string, any>) || {};
      context.__selected_option_id = selectedOptionId;
      context.__interactive_response_received = true;
      context.__resumed_from_interactive_message = true;

      // Update execution to resume from the next node
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'running',
          context: context as any,
        },
      });

      // Queue the execution to resume
      await this.jobs.enqueueExecuteWorkflow(executionId);

      return true;
    } catch (error) {
      this.logger.error(`Failed to resume workflow: ${error}`);
      return false;
    }
  }

  /**
   * Save user selection for analytics
   */
  private async saveUserSelection(
    phoneNumber: string,
    optionId: number,
  ): Promise<void> {
    try {
      const userState = await this.userStateService.getUserState(phoneNumber);
      if (!userState) return;

      const templateId = this.userStateService.getTemplateIdFromState(userState);
      if (!templateId) return;

      // Convert templateId to number (it's stored as string in metadata)
      const templateIdNum = typeof templateId === 'string' ? parseInt(templateId, 10) : templateId;
      const workflowId = userState?.workflowId || 0;

      // Save to button click analytics
      await this.prisma.buttonClickAnalytics.create({
        data: {
          templateId: templateIdNum,
          optionId,
          phoneNumber,
          workflowId,
          clickedAt: new Date(),
          responseTimeMs: 0, // Can be calculated if we track send time
        },
      });
    } catch (error) {
      // Don't fail if analytics fails
      this.logger.warn(`Failed to save user selection: ${error}`);
    }
  }

  /**
   * Get button click statistics for analytics
   */
  async getButtonClickStats(
    templateId: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    try {
      const where: any = { templateId };

      if (startDate || endDate) {
        where.clickedAt = {};
        if (startDate) where.clickedAt.gte = startDate;
        if (endDate) where.clickedAt.lte = endDate;
      }

      const clicks = await this.prisma.buttonClickAnalytics.findMany({
        where,
      });

      // Get option details for each click
      const optionIds = [...new Set(clicks.map((c) => c.optionId))];
      const options = await this.prisma.interactiveMessageOption.findMany({
        where: { id: { in: optionIds } },
      });
      const optionsMap = new Map(options.map((o) => [o.id, o]));

      // Group by option
      const statsByOption: Record<number, any> = {};
      clicks.forEach((click) => {
        const optionId = click.optionId;
        const option = optionsMap.get(optionId);
        if (!statsByOption[optionId]) {
          statsByOption[optionId] = {
            optionId,
            optionText: option?.optionText || 'Unknown',
            clicks: 0,
            avgResponseTimeMs: 0,
          };
        }
        statsByOption[optionId].clicks++;
        if (click.responseTimeMs) {
          statsByOption[optionId].avgResponseTimeMs += click.responseTimeMs;
        }
      });

      // Calculate averages
      Object.values(statsByOption).forEach((stat: any) => {
        if (stat.clicks > 0) {
          stat.avgResponseTimeMs = Math.round(
            stat.avgResponseTimeMs / stat.clicks,
          );
        }
      });

      return {
        templateId,
        totalClicks: clicks.length,
        optionStats: Object.values(statsByOption),
        period: {
          startDate,
          endDate,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting button click stats: ${error}`);
      return {
        templateId,
        totalClicks: 0,
        optionStats: [],
      };
    }
  }
}
