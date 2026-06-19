import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if this is a new event and processing should continue.
   * Returns false if the key was already processed (duplicate delivery).
   */
  async claim(source: string, idempotencyKey: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
    const key = `${source}:${idempotencyKey}`.slice(0, 128);
    const expiresAt = new Date(Date.now() + ttlMs);

    try {
      await this.prisma.processedWebhookEvent.create({
        data: { source, idempotencyKey: key, expiresAt },
      });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.debug(`Duplicate webhook ignored: ${key}`);
        return false;
      }
      throw err;
    }
  }

  buildRazorpayKey(event: string, payload: Record<string, unknown>): string {
    const payment = (payload.payload as Record<string, unknown> | undefined)?.payment as
      | { entity?: { id?: string } }
      | undefined;
    const subscription = (payload.payload as Record<string, unknown> | undefined)?.subscription as
      | { entity?: { id?: string } }
      | undefined;
    const paymentId = payment?.entity?.id;
    const subscriptionId = subscription?.entity?.id;
    if (paymentId) {
      return `${event}:${paymentId}`;
    }
    if (subscriptionId) {
      return `${event}:${subscriptionId}`;
    }
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
  }

  async purgeExpired(): Promise<number> {
    const result = await this.prisma.processedWebhookEvent.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
