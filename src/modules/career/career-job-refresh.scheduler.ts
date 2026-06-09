import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';
import { CareerJobAlertService } from './services/career-job-alert.service';

/**
 * Keywords fetched on each refresh cycle.
 * Covers the most common job categories searched by Indian job seekers.
 * Each keyword runs all enabled sources (Adzuna + JSearch when configured).
 */
const REFRESH_KEYWORDS = [
  'software developer',
  'frontend developer',
  'backend developer',
  'full stack developer',
  'data analyst',
  'digital marketing',
  'sales executive',
  'business development',
];

/** How often to refresh (ms). Default 6 hours. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Delay before the first run after server start (ms). Avoids hammering the API on every hot-reload. */
const STARTUP_DELAY_MS = 90_000;

/** Keywords run in parallel during manual refresh (keeps total time under nginx limits when awaited). */
const KEYWORD_BATCH_SIZE = 2;

@Injectable()
export class CareerJobRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(CareerJobRefreshScheduler.name);
  private readonly activeUserRefreshes = new Set<number>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fetcher: CareerJobFetcherService,
    private readonly alerts: CareerJobAlertService,
  ) {}

  onModuleInit(): void {
    if ((this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss') === 'pgboss') {
      this.logger.log('Job refresh uses pg-boss schedule (CareerPgBossScheduler)');
      return;
    }

    if (!this.fetcher.isEnabled()) {
      this.logger.log('Job refresh scheduler inactive — no job sources configured');
      return;
    }

    // First run after startup delay, then every REFRESH_INTERVAL_MS.
    setTimeout(() => {
      void this.run();
      setInterval(() => void this.run(), REFRESH_INTERVAL_MS);
    }, STARTUP_DELAY_MS);

    this.logger.log(
      `Job refresh scheduler active — first run in ${STARTUP_DELAY_MS / 1000}s, then every ${REFRESH_INTERVAL_MS / 3_600_000}h`,
    );
  }

  /**
   * Portal manual refresh — returns immediately so nginx does not 504.
   * Work continues in-process (1–3 min for all keywords × sources).
   */
  startForUser(userId: number): { status: 'started' | 'already_running'; message: string } {
    if (this.activeUserRefreshes.has(userId)) {
      return {
        status: 'already_running',
        message: 'Job refresh is already running — reload the jobs list in a minute.',
      };
    }

    this.activeUserRefreshes.add(userId);
    void this.runForUser(userId)
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Job refresh failed userId=${userId}: ${message}`);
      })
      .finally(() => {
        this.activeUserRefreshes.delete(userId);
      });

    return {
      status: 'started',
      message:
        'Job refresh started in the background (Adzuna + JSearch, ~1–3 min). Reload this page shortly.',
    };
  }

  /** Refresh jobs for a single tenant. */
  async runForUser(userId: number): Promise<{
    expired: number;
    fetched: number;
    bySource: Record<string, number>;
  }> {
    this.logger.log(`Job refresh starting for userId=${userId}…`);
    const refreshStartedAt = new Date();
    const expired = await this.fetcher.expireStaleJobs(30);

    const bySource: Record<string, number> = {};
    let fetched = 0;

    for (let i = 0; i < REFRESH_KEYWORDS.length; i += KEYWORD_BATCH_SIZE) {
      const batch = REFRESH_KEYWORDS.slice(i, i + KEYWORD_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((keyword) =>
          this.fetcher.fetchAndStoreDetailed(userId, keyword, 'india', 1),
        ),
      );
      for (const result of batchResults) {
        fetched += result.total;
        for (const [sourceId, count] of Object.entries(result.bySource)) {
          bySource[sourceId] = (bySource[sourceId] ?? 0) + count;
        }
      }
    }

    this.logger.log(
      `Job refresh complete userId=${userId} — expired=${expired} fetched=${fetched} (${Object.entries(bySource)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')})`,
    );

    const newJobIds = await this.fetcher.findJobsCreatedSince(userId, refreshStartedAt);
    await this.alerts.processNewJobsForUser(userId, newJobIds);

    return { expired, fetched, bySource };
  }

  /** Scheduled refresh for all career_ai tenants. */
  async run(): Promise<{ expired: number; fetched: number; bySource: Record<string, number> }> {
    this.logger.log('Job refresh cycle starting…');

    const expired = await this.fetcher.expireStaleJobs(30);

    const settings = await this.prisma.userSetting.findMany({
      where: { key: 'business_category', value: 'career_ai' },
      select: { userId: true },
    });

    const bySource: Record<string, number> = {};
    let fetched = 0;

    for (const { userId } of settings) {
      const refreshStartedAt = new Date();
      for (let i = 0; i < REFRESH_KEYWORDS.length; i += KEYWORD_BATCH_SIZE) {
        const batch = REFRESH_KEYWORDS.slice(i, i + KEYWORD_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((keyword) =>
            this.fetcher.fetchAndStoreDetailed(userId, keyword, 'india', 1),
          ),
        );
        for (const result of batchResults) {
          fetched += result.total;
          for (const [sourceId, count] of Object.entries(result.bySource)) {
            bySource[sourceId] = (bySource[sourceId] ?? 0) + count;
          }
        }
      }

      const newJobIds = await this.fetcher.findJobsCreatedSince(userId, refreshStartedAt);
      await this.alerts.processNewJobsForUser(userId, newJobIds);
    }

    this.logger.log(
      `Job refresh complete — expired=${expired} fetched=${fetched} (${Object.entries(bySource)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')})`,
    );
    return { expired, fetched, bySource };
  }
}
