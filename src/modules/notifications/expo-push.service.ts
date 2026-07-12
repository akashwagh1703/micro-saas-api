import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Sends high-priority push alerts via Expo Push API (Android booking channel). */
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

    const messages = tokens.map((row) => ({
      to: row.expoPushToken,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      priority: 'high' as const,
      channelId: 'bookings',
      data: payload.data ?? {},
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
        this.logger.warn(`Expo push HTTP ${response.status} for user ${userId}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Expo push failed for user ${userId}: ${message}`);
    }
  }
}
