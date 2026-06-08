import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { CareerDigestService } from './services/career-digest.service';

/**
 * Daily CareerAI WhatsApp digest.
 * Uses CAREER_DIGEST_TIMEZONE + CAREER_DIGEST_HOUR (local wall clock).
 * Falls back to CAREER_DIGEST_HOUR_UTC in UTC when timezone is not set.
 */
@Injectable()
export class CareerDigestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CareerDigestScheduler.name);
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly digest: CareerDigestService,
  ) {}

  onModuleInit(): void {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') === 'pgboss') {
      this.logger.log('Career digest uses pg-boss schedule (CareerPgBossScheduler)');
      return;
    }

    if (this.config.get<string>('CAREER_DIGEST_ENABLED') === 'false') {
      this.logger.log('Career daily digest scheduler disabled (CAREER_DIGEST_ENABLED=false)');
      return;
    }

    const timezone = this.config.get<string>('CAREER_DIGEST_TIMEZONE')?.trim() || '';
    const hourLocalRaw = this.config.get<string>('CAREER_DIGEST_HOUR');
    const hourUtcRaw = this.config.get<string>('CAREER_DIGEST_HOUR_UTC') ?? '8';

    let hour: number;
    let tz: string;

    if (timezone && hourLocalRaw !== undefined && hourLocalRaw !== '') {
      hour = parseInt(hourLocalRaw, 10);
      tz = timezone;
    } else {
      hour = parseInt(hourUtcRaw, 10);
      tz = 'UTC';
    }

    if (Number.isNaN(hour) || hour < 0 || hour > 23) {
      this.logger.error(`Invalid digest hour — local="${hourLocalRaw}" utc="${hourUtcRaw}"`);
      return;
    }

    const expression = `0 ${hour} * * *`;
    if (!cron.validate(expression)) {
      this.logger.error(`Invalid cron expression: ${expression}`);
      return;
    }

    this.task = cron.schedule(
      expression,
      () => {
        void this.runBatch();
      },
      { timezone: tz },
    );

    this.logger.log(
      `Career digest scheduled daily at ${hour}:00 (${tz}) — cron: ${expression}`,
    );
  }

  onModuleDestroy(): void {
    this.task?.stop();
    this.task = null;
  }

  private async runBatch(): Promise<void> {
    this.logger.log('Running daily CareerAI digest batch…');
    try {
      const result = await this.digest.runDailyDigestBatch();
      this.logger.log(
        `Daily digest batch complete — sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
      );
    } catch (e: any) {
      this.logger.error(`Digest batch failed: ${e.message}`);
    }
  }
}
