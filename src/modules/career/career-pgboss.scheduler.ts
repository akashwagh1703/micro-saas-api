import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import {
  QUEUE_CAREER_DIGEST,
  QUEUE_CAREER_JOB_REFRESH,
  QUEUE_CAREER_RETENTION,
} from '../queue/queue.constants';
import { CareerDigestService } from './services/career-digest.service';
import { CareerJobRefreshScheduler } from './career-job-refresh.scheduler';
import { CareerPrivacyService } from './services/career-privacy.service';

/**
 * Distributed cron via pg-boss (PostgreSQL) — only one instance runs each schedule
 * even when multiple API pods are deployed.
 */
@Injectable()
export class CareerPgBossScheduler implements OnModuleInit {
  private readonly logger = new Logger(CareerPgBossScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly digest: CareerDigestService,
    private readonly jobRefresh: CareerJobRefreshScheduler,
    private readonly privacy: CareerPrivacyService,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') !== 'pgboss') {
      return;
    }

    await this.queue.work(QUEUE_CAREER_DIGEST, async () => {
      this.logger.log('pg-boss: running career digest batch');
      await this.digest.runDailyDigestBatch();
    });

    await this.queue.work(QUEUE_CAREER_JOB_REFRESH, async () => {
      this.logger.log('pg-boss: running career job refresh');
      await this.jobRefresh.run();
    });

    await this.queue.work(QUEUE_CAREER_RETENTION, async () => {
      this.logger.log('pg-boss: running resume text retention purge');
      await this.privacy.purgeExpiredResumeText();
    });

    if (this.config.get<string>('CAREER_DIGEST_ENABLED') !== 'false') {
      const tz =
        this.config.get<string>('CAREER_DIGEST_TIMEZONE')?.trim() || 'Asia/Kolkata';
      const hourLocal = parseInt(
        this.config.get<string>('CAREER_DIGEST_HOUR') ??
          this.config.get<string>('CAREER_DIGEST_HOUR_UTC') ??
          '8',
        10,
      );
      const cron = `0 ${hourLocal} * * *`;
      await this.queue.scheduleCron(QUEUE_CAREER_DIGEST, cron, {}, { tz });
      this.logger.log(`pg-boss digest scheduled: ${cron} (${tz})`);
    }

    await this.queue.scheduleCron(QUEUE_CAREER_JOB_REFRESH, '0 */6 * * *', {}, { tz: 'UTC' });
    this.logger.log('pg-boss job refresh scheduled: every 6 hours (UTC)');

    const retentionDays = parseInt(
      this.config.get<string>('CAREER_RESUME_TEXT_RETENTION_DAYS') ?? '365',
      10,
    );
    if (!Number.isNaN(retentionDays) && retentionDays > 0) {
      await this.queue.scheduleCron(QUEUE_CAREER_RETENTION, '0 3 * * *', {}, { tz: 'UTC' });
      this.logger.log(`pg-boss resume text retention scheduled daily 03:00 UTC (${retentionDays} days)`);
    }
  }
}
