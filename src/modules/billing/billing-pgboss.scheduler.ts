import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import { QUEUE_BILLING_PAYMENT_EXPIRY } from '../queue/queue.constants';
import { ManualPaymentExpiryService } from './manual-payment-expiry.service';

@Injectable()
export class BillingPgBossScheduler {
  private readonly logger = new Logger(BillingPgBossScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly expiry: ManualPaymentExpiryService,
  ) {}

  async registerSchedules(): Promise<void> {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') !== 'pgboss') {
      return;
    }

    try {
      await this.queue.waitUntilReady();
      if (!this.queue.isBossRunning()) {
        this.logger.warn('pg-boss unavailable; billing cron schedules skipped');
        return;
      }

      await this.queue.work(QUEUE_BILLING_PAYMENT_EXPIRY, async () => {
        this.logger.log('pg-boss: expiring stale UPI payment submissions');
        await this.expiry.expireStalePendingSubmissions();
      });

      await this.queue.scheduleCron(QUEUE_BILLING_PAYMENT_EXPIRY, '0 4 * * *', {}, { tz: 'UTC' });
      this.logger.log(
        `pg-boss UPI payment expiry scheduled daily 04:00 UTC (${this.expiry.pendingDays()} day window)`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Billing pg-boss schedules skipped (API still online): ${message}`);
    }
  }
}
