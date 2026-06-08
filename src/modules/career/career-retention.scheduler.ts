import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { CareerPrivacyService } from './services/career-privacy.service';

/** Purges old resume text from the database (local cron fallback when pg-boss is off). */
@Injectable()
export class CareerRetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(CareerRetentionScheduler.name);
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly privacy: CareerPrivacyService,
  ) {}

  onModuleInit(): void {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') === 'pgboss') {
      this.logger.log('Resume text retention uses pg-boss schedule (CareerPgBossScheduler)');
      return;
    }

    const days = parseInt(this.config.get<string>('CAREER_RESUME_TEXT_RETENTION_DAYS') ?? '365', 10);
    if (Number.isNaN(days) || days <= 0) {
      this.logger.log('Resume text retention disabled (CAREER_RESUME_TEXT_RETENTION_DAYS=0)');
      return;
    }

    this.task = cron.schedule('0 3 * * *', () => {
      void this.run();
    });

    this.logger.log(`Resume text retention scheduled daily at 03:00 UTC (${days}-day window)`);
  }

  async run() {
    return this.privacy.purgeExpiredResumeText();
  }
}
