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

  async handleButtonResponse(
    userId: number,
    phoneNumber: string,
    optionId: number,
  ): Promise<{
    success: boolean;
    message?: string;
    workflowId?: number;
    nextNodeId?: string;
  }> {
    try {
      const userState = await this.userStateService.getUserState(userId, phoneNumber);

      if (!userState) {
        return {
          success: false,
          message: 'No active workflow for this user',
        };
      }

      if (userState.status !== 'WAITING_FOR_RESPONSE') {
        this.logger.warn(
          `User ${phoneNumber} (tenant ${userId}) not waiting for response (status=${userState.status})`,
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

      const option = await this.prisma.interactiveMessageOption.findUnique({
        where: { id: optionId },
      });

      if (!option) {
        return {
          success: false,
          message: `Option not found (id=${optionId})`,
        };
      }

      const templateIdFromState = this.userStateService.getTemplateIdFromState(userState);
      const templateIdNum =
        typeof templateIdFromState === 'string'
          ? parseInt(templateIdFromState, 10)
          : templateIdFromState;

      if (!templateIdNum || templateIdNum !== option.templateId) {
        return {
          success: false,
          message: 'Option does not match current template',
        };
      }

      const nextNodeId = option.nextNodeId;
      if (!nextNodeId) {
        this.logger.warn(`Option ${optionId} has no next node routing configured`);
        await this.userStateService.clearUserState(userId, phoneNumber);
        return {
          success: true,
          message: 'No next node configured - workflow ends',
        };
      }

      await this.saveUserSelection(userId, phoneNumber, optionId);

      const execution = await this.prisma.workflowExecution.findFirst({
        where: {
          userId,
          workflowId: userState.workflowId,
          status: 'waiting',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!execution) {
        await this.userStateService.clearUserState(userId, phoneNumber);
        return {
          success: true,
          message: 'No active execution found - cleared state',
        };
      }

      const resumed = await this.resumeWorkflowAtNode(
        execution.id,
        nextNodeId,
        String(optionId),
      );

      if (!resumed) {
        return {
          success: false,
          message: 'Failed to resume workflow',
        };
      }

      await this.userStateService.clearUserState(userId, phoneNumber);

      return {
        success: true,
        workflowId: userState.workflowId,
        nextNodeId,
      };
    } catch (error: any) {
      this.logger.error(`Error handling button response: ${error.message}`);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  private async resumeWorkflowAtNode(
    executionId: number,
    nextNodeId: string,
    selectedOptionId: string,
  ): Promise<boolean> {
    try {
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return false;
      }

      const option = await this.prisma.interactiveMessageOption.findUnique({
        where: { id: parseInt(selectedOptionId, 10) },
      });

      const context = (execution.context as Record<string, any>) || {};
      context.__selected_option_id = selectedOptionId;
      context.__interactive_response_received = true;
      context.__resumed_from_interactive_message = true;
      context.__resuming = true;
      context.__resume_at_node_id = nextNodeId;
      delete context.__paused_at_node_id;

      if (option?.metadata && typeof option.metadata === 'object' && !Array.isArray(option.metadata)) {
        const meta = option.metadata as Record<string, unknown>;
        if (meta.resource_id != null) {
          context.resource_id = meta.resource_id;
          context.selected_resource_id = meta.resource_id;
        }
        if (meta.resource_name != null) {
          context.resource_name = meta.resource_name;
        }
        if (meta.starts_at != null) {
          context.slot_starts_at = meta.starts_at;
          context.selected_slot_starts_at = meta.starts_at;
        }
        if (meta.ends_at != null) {
          context.slot_ends_at = meta.ends_at;
        }
        if (meta.preferred_date != null) {
          context.preferred_date = meta.preferred_date;
        }
      }

      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'running',
          context: context as any,
        },
      });

      await this.jobs.enqueueExecuteWorkflow(executionId);

      return true;
    } catch (error) {
      this.logger.error(`Failed to resume workflow: ${error}`);
      return false;
    }
  }

  private async saveUserSelection(
    userId: number,
    phoneNumber: string,
    optionId: number,
  ): Promise<void> {
    try {
      const userState = await this.userStateService.getUserState(userId, phoneNumber);
      if (!userState) return;

      const templateId = this.userStateService.getTemplateIdFromState(userState);
      if (!templateId) return;

      const templateIdNum =
        typeof templateId === 'string' ? parseInt(templateId, 10) : templateId;
      const workflowId = userState.workflowId || 0;

      await this.prisma.buttonClickAnalytics.create({
        data: {
          templateId: templateIdNum,
          optionId,
          phoneNumber,
          workflowId,
          clickedAt: new Date(),
          responseTimeMs: 0,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to save user selection: ${error}`);
    }
  }

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

      const optionIds = [...new Set(clicks.map((c) => c.optionId))];
      const options = await this.prisma.interactiveMessageOption.findMany({
        where: { id: { in: optionIds } },
      });
      const optionsMap = new Map(options.map((o) => [o.id, o]));

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

      Object.values(statsByOption).forEach((stat: any) => {
        if (stat.clicks > 0) {
          stat.avgResponseTimeMs = Math.round(stat.avgResponseTimeMs / stat.clicks);
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
