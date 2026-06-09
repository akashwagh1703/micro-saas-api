import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';

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

@Injectable()
export class CareerJobRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(CareerJobRefreshScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fetcher: CareerJobFetcherService,
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

  /** Refresh jobs for a single tenant (portal manual refresh). */
  async runForUser(userId: number): Promise<{
    expired: number;
    fetched: number;
    bySource: Record<string, number>;
  }> {
    this.logger.log(`Job refresh starting for userId=${userId}…`);
    const expired = await this.fetcher.expireStaleJobs(30);

    const bySource: Record<string, number> = {};
    let fetched = 0;

    for (const keyword of REFRESH_KEYWORDS) {
      const result = await this.fetcher.fetchAndStoreDetailed(userId, keyword, 'india', 1);
      fetched += result.total;
      for (const [sourceId, count] of Object.entries(result.bySource)) {
        bySource[sourceId] = (bySource[sourceId] ?? 0) + count;
      }
    }

    this.logger.log(
      `Job refresh complete userId=${userId} — expired=${expired} fetched=${fetched} (${Object.entries(bySource)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')})`,
    );
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
      for (const keyword of REFRESH_KEYWORDS) {
        const result = await this.fetcher.fetchAndStoreDetailed(userId, keyword, 'india', 1);
        fetched += result.total;
        for (const [sourceId, count] of Object.entries(result.bySource)) {
          bySource[sourceId] = (bySource[sourceId] ?? 0) + count;
        }
      }
    }

    this.logger.log(
      `Job refresh complete — expired=${expired} fetched=${fetched} (${Object.entries(bySource)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')})`,
    );
    return { expired, fetched, bySource };
  }
}
