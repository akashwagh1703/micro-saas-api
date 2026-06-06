import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { CareerDigestService } from './services/career-digest.service';

/**
 * Daily CareerAI WhatsApp digest — runs at CAREER_DIGEST_HOUR_UTC (UTC) via node-cron.
 * Cron survives process restarts and fires at a fixed wall-clock time each day.
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
    if (this.config.get<string>('CAREER_DIGEST_ENABLED') === 'false') {
      this.logger.log('Career daily digest scheduler disabled (CAREER_DIGEST_ENABLED=false)');
      return;
    }

    const hourRaw = this.config.get<string>('CAREER_DIGEST_HOUR_UTC') ?? '8';
    const hourUtc = parseInt(hourRaw, 10);
    if (Number.isNaN(hourUtc) || hourUtc < 0 || hourUtc > 23) {
      this.logger.error(`Invalid CAREER_DIGEST_HOUR_UTC="${hourRaw}" — must be 0–23`);
      return;
    }

    const expression = `0 ${hourUtc} * * *`;
    if (!cron.validate(expression)) {
      this.logger.error(`Invalid cron expression: ${expression}`);
      return;
    }

    this.task = cron.schedule(
      expression,
      () => {
        void this.runBatch();
      },
      { timezone: 'UTC' },
    );

    this.logger.log(`Career digest scheduled at ${hourUtc}:00 UTC daily (cron: ${expression})`);
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
