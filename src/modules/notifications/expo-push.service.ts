import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushChannel } from './owner-notification.types';

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android/Expo channel; defaults to bookings. */
  channelId?: string;
}

/** Sends high-priority push alerts via Expo Push API (lock screen + app closed). */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendToUser(userId: number, payload: ExpoPushPayload): Promise<void> {
    const tokens = await this.prisma.pushDeviceToken.findMany({
      where: { userId },
      select: { expoPushToken: true },
    });
    if (!tokens.length) return;

    const channelId = payload.channelId?.trim() || PushChannel.BOOKINGS;

    const messages = tokens.map((row) => ({
      to: row.expoPushToken,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      priority: 'high' as const,
      channelId,
      badge: 1,
      ttl: 300,
      data: payload.data ?? {},
      android: {
        channelId,
        priority: 'high' as const,
        sound: 'default',
        vibrate: [0, 300, 200, 300],
        visibility: 'public' as const,
      },
      ios: {
        sound: 'default',
        badge: 1,
        _displayInForeground: true,
      },
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(`Expo push HTTP ${response.status} for user ${userId}: ${text}`);
        return;
      }
      const result = (await response.json()) as {
        data?: Array<{ status?: string; message?: string; details?: unknown }>;
      };
      const errors = (result.data ?? []).filter((item) => item.status === 'error');
      if (errors.length) {
        this.logger.warn(`Expo push delivery errors for user ${userId}: ${JSON.stringify(errors)}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Expo push failed for user ${userId}: ${message}`);
    }
  }
}
