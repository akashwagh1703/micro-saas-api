import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerDigestService } from './services/career-digest.service';

/** Runs daily CareerAI WhatsApp job digests (08:00 UTC by default). */
@Injectable()
export class CareerDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(CareerDigestScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly digest: CareerDigestService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAREER_DIGEST_ENABLED') === 'false') {
      this.logger.log('Career daily digest scheduler disabled');
      return;
    }

    const hourUtc = parseInt(this.config.get<string>('CAREER_DIGEST_HOUR_UTC') ?? '8', 10);
    this.scheduleNextRun(hourUtc);
    this.logger.log(`Career digest scheduler active (daily ~${hourUtc}:00 UTC)`);
  }

  private scheduleNextRun(hourUtc: number): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, 0, 0, 0);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const delay = next.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        await this.digest.runDailyDigestBatch();
      } catch (e: any) {
        this.logger.error(`Daily digest batch failed: ${e.message}`);
      }
      this.scheduleNextRun(hourUtc);
    }, delay);
  }
}
