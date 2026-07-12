import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserWorkflowState } from '@prisma/client';
import { normalizeWhatsAppPhone } from './nodes/booking-node.helpers';

/**
 * User State Service
 * Manages per-tenant workflow state for interactive message flows.
 */
@Injectable()
export class UserStateService {
  private readonly logger = new Logger(UserStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizePhone(phoneNumber: string): string {
    return normalizeWhatsAppPhone(phoneNumber);
  }

  private tenantPhoneKey(userId: number, phoneNumber: string) {
    return { userId_phoneNumber: { userId, phoneNumber: this.normalizePhone(phoneNumber) } };
  }

  async getUserState(
    userId: number,
    phoneNumber: string,
  ): Promise<UserWorkflowState | null> {
    try {
      return (
        (await this.prisma.userWorkflowState.findUnique({
          where: this.tenantPhoneKey(userId, phoneNumber),
        })) ?? null
      );
    } catch (error) {
      this.logger.error(`Error getting user state: ${error}`);
      return null;
    }
  }

  async saveUserState(
    userId: number,
    phoneNumber: string,
    workflowId: number,
    nodeId: string,
    templateId?: string | null,
    status: string = 'WAITING_FOR_RESPONSE',
  ): Promise<UserWorkflowState> {
    return await this.prisma.userWorkflowState.upsert({
      where: this.tenantPhoneKey(userId, phoneNumber),
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
        userId,
        phoneNumber: this.normalizePhone(phoneNumber),
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

  async clearUserState(userId: number, phoneNumber: string): Promise<void> {
    try {
      await this.prisma.userWorkflowState.delete({
        where: this.tenantPhoneKey(userId, phoneNumber),
      });
    } catch (error: any) {
      if (!error.code?.includes('P2025')) {
        this.logger.warn(`Error clearing user state: ${error}`);
      }
    }
  }

  getTemplateIdFromState(state: UserWorkflowState): string | null {
    try {
      const metadata = state.metadata as any;
      return metadata?.templateId || null;
    } catch {
      return null;
    }
  }

  async isWaitingForResponse(
    userId: number,
    phoneNumber: string,
  ): Promise<boolean> {
    const state = await this.getUserState(userId, phoneNumber);
    if (!state || state.status !== 'WAITING_FOR_RESPONSE') {
      return false;
    }
    return !!this.getTemplateIdFromState(state);
  }

  async timeoutUserState(
    userId: number,
    phoneNumber: string,
    timeoutSeconds: number = 3600,
  ): Promise<void> {
    try {
      const state = await this.getUserState(userId, phoneNumber);
      if (!state) return;

      const createdAt = state.createdAt || state.updatedAt;
      const elapsedSeconds = (Date.now() - createdAt.getTime()) / 1000;

      if (elapsedSeconds > timeoutSeconds) {
        await this.clearUserState(userId, phoneNumber);
        this.logger.debug(`User state timed out for tenant ${userId} / ${phoneNumber}`);
      }
    } catch (error) {
      this.logger.warn(`Error timing out user state: ${error}`);
    }
  }

  async getAllActiveStates(userId?: number) {
    try {
      return await this.prisma.userWorkflowState.findMany({
        where: userId ? { userId } : undefined,
      });
    } catch (error) {
      this.logger.error(`Error getting all active states: ${error}`);
      return [];
    }
  }

  async getActiveStatesForWorkflow(workflowId: number, userId?: number) {
    try {
      return await this.prisma.userWorkflowState.findMany({
        where: {
          workflowId,
          ...(userId ? { userId } : {}),
        },
      });
    } catch (error) {
      this.logger.error(`Error getting active states for workflow: ${error}`);
      return [];
    }
  }
}
