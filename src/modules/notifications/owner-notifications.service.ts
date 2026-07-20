import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpoPushService } from './expo-push.service';
import { pushChannelForType } from './owner-notification.types';

export interface CreateOwnerNotificationInput {
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  sendPush?: boolean;
  /** Override Android/Expo channel; defaults from notification type. */
  pushChannelId?: string;
}

function serializeNotification(row: {
  id: number;
  type: string;
  title: string;
  body: string;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata,
    read_at: row.readAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    is_read: row.readAt != null,
  };
}

@Injectable()
export class OwnerNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expoPush: ExpoPushService,
  ) {}

  async notify(userId: number, input: CreateOwnerNotificationInput) {
    const row = await this.prisma.ownerNotification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    if (input.sendPush !== false) {
      void this.expoPush.sendToUser(userId, {
        title: input.title,
        body: input.body,
        channelId: input.pushChannelId ?? pushChannelForType(input.type),
        data: {
          type: input.type,
          notification_id: row.id,
          ...(input.metadata ?? {}),
        },
      });
    }

    return serializeNotification(row);
  }

  async list(userId: number, options?: { unreadOnly?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
    const rows = await this.prisma.ownerNotification.findMany({
      where: {
        userId,
        ...(options?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { data: rows.map(serializeNotification) };
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.ownerNotification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: number, notificationId: number) {
    const row = await this.prisma.ownerNotification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    const updated = await this.prisma.ownerNotification.update({
      where: { id: row.id },
      data: { readAt: row.readAt ?? new Date() },
    });
    return { notification: serializeNotification(updated) };
  }

  async markAllRead(userId: number) {
    const result = await this.prisma.ownerNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async registerPushToken(userId: number, expoPushToken: string, platform: string) {
    const token = expoPushToken.trim();
    if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
      return { registered: false, message: 'Invalid Expo push token' };
    }

    await this.prisma.pushDeviceToken.upsert({
      where: { expoPushToken: token },
      update: { userId, platform, updatedAt: new Date() },
      create: { userId, expoPushToken: token, platform },
    });

    return { registered: true };
  }
}
