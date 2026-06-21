import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserWorkflowState } from '@prisma/client';

/**
 * User State Service
 * Manages user workflow state - tracks where a user is in a workflow
 * and what interactive message they're waiting to respond to
 */
@Injectable()
export class UserStateService {
  private readonly logger = new Logger(UserStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the current state of a user in any workflow
   */
  async getUserState(phoneNumber: string): Promise<UserWorkflowState | null> {
    try {
      const state = await this.prisma.userWorkflowState.findUnique({
        where: { phoneNumber },
      });
      return state || null;
    } catch (error) {
      this.logger.error(`Error getting user state: ${error}`);
      return null;
    }
  }

  /**
   * Save or update user state
   * Note: Template ID is stored in metadata JSON for flexibility
   */
  async saveUserState(
    phoneNumber: string,
    workflowId: number,
    nodeId: string,
    templateId?: string | null,
    status: string = 'WAITING_FOR_RESPONSE',
  ): Promise<UserWorkflowState> {
    return await this.prisma.userWorkflowState.upsert({
      where: { phoneNumber },
      update: {
        workflowId,
        currentNodeId: nodeId,
        status,
        metadata: {
          templateId: templateId || null,
          lastUpdated: new Date().toISOString(),
        } as any,
        updatedAt: new Date(),
      },
      create: {
        phoneNumber,
        workflowId,
        currentNodeId: nodeId,
        status,
        metadata: {
          templateId: templateId || null,
          createdAt: new Date().toISOString(),
        } as any,
      },
    });
  }

  /**
   * Clear user state after workflow completes or times out
   */
  async clearUserState(phoneNumber: string): Promise<void> {
    try {
      await this.prisma.userWorkflowState.delete({
        where: { phoneNumber },
      });
    } catch (error: any) {
      // Silently ignore if state doesn't exist
      if (!error.code?.includes('P2025')) {
        this.logger.warn(`Error clearing user state: ${error}`);
      }
    }
  }

  /**
   * Get the template ID from user state metadata
   */
  getTemplateIdFromState(state: UserWorkflowState): string | null {
    try {
      const metadata = state.metadata as any;
      return metadata?.templateId || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user is waiting for interactive message response
   */
  async isWaitingForResponse(phoneNumber: string): Promise<boolean> {
    const state = await this.getUserState(phoneNumber);
    if (!state || state.status !== 'WAITING_FOR_RESPONSE') {
      return false;
    }
    const templateId = this.getTemplateIdFromState(state);
    return !!templateId;
  }

  /**
   * Timeout user state - move from waiting to timeout
   */
  async timeoutUserState(
    phoneNumber: string,
    timeoutSeconds: number = 3600,
  ): Promise<void> {
    try {
      const state = await this.getUserState(phoneNumber);
      if (!state) return;

      const createdAt = state.createdAt || state.updatedAt;
      const elapsedSeconds = (Date.now() - createdAt.getTime()) / 1000;

      if (elapsedSeconds > timeoutSeconds) {
        await this.clearUserState(phoneNumber);
        this.logger.debug(
          `User state timed out for ${phoneNumber}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Error timing out user state: ${error}`);
    }
  }

  /**
   * Get all active user states (for monitoring/debugging)
   */
  async getAllActiveStates() {
    try {
      return await this.prisma.userWorkflowState.findMany();
    } catch (error) {
      this.logger.error(`Error getting all active states: ${error}`);
      return [];
    }
  }

  /**
   * Get active states for a specific workflow
   */
  async getActiveStatesForWorkflow(workflowId: number) {
    try {
      return await this.prisma.userWorkflowState.findMany({
        where: { workflowId },
      });
    } catch (error) {
      this.logger.error(
        `Error getting active states for workflow: ${error}`,
      );
      return [];
    }
  }
}
