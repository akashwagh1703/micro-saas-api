import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerDigestService } from './services/career-digest.service';

/**
 * Schedules the daily CareerAI WhatsApp job digest.
 *
 * Previous implementation used recursive setTimeout which:
 *  - Drifted over time (each run's execution time shifted the next run)
 *  - Missed the scheduled hour when the server restarted after the target time
 *
 * New implementation ticks every minute with setInterval and fires when
 * the current UTC hour matches CAREER_DIGEST_HOUR_UTC.  A simple "fired today"
 * flag prevents double-firing within the same hour.
 */
@Injectable()
export class CareerDigestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CareerDigestScheduler.name);
  private interval: NodeJS.Timeout | null = null;
  private lastFiredDate: string | null = null; // 'YYYY-MM-DD' in UTC

  constructor(
    private readonly config: ConfigService,
    private readonly digest: CareerDigestService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAREER_DIGEST_ENABLED') === 'false') {
      this.logger.log('Career daily digest scheduler disabled (CAREER_DIGEST_ENABLED=false)');
      return;
    }

    const hourUtc = parseInt(
      this.config.get<string>('CAREER_DIGEST_HOUR_UTC') ?? '3',
      10,
    );

    // Tick every 60 seconds and check whether it is time to fire.
    this.interval = setInterval(() => void this.tick(hourUtc), 60_000);
    this.logger.log(`Career digest scheduler active — fires daily at ${hourUtc}:00 UTC`);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(targetHourUtc: number): Promise<void> {
    const now = new Date();
    const currentHourUtc = now.getUTCHours();
    const todayUtc = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    if (currentHourUtc !== targetHourUtc) return;
    if (this.lastFiredDate === todayUtc) return; // Already ran today.

    this.lastFiredDate = todayUtc;
    this.logger.log(`Running daily digest batch (${todayUtc} ${targetHourUtc}:00 UTC)…`);

    try {
      await this.digest.runDailyDigestBatch();
      this.logger.log('Daily digest batch complete');
    } catch (e: any) {
      this.logger.error(`Daily digest batch failed: ${e.message}`);
    }
  }
}
