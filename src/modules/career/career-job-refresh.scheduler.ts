import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';

/**
 * Keywords fetched on each refresh cycle.
 * Covers the most common job categories searched by Indian job seekers.
 * Each keyword costs 1 Adzuna API request (free tier: 250/day).
 * At 8 keywords × all career_ai tenants we stay well within the free limit
 * for typical usage (< 30 tenants).
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
    private readonly prisma: PrismaService,
    private readonly fetcher: CareerJobFetcherService,
  ) {}

  onModuleInit(): void {
    if (!this.fetcher.isEnabled()) {
      this.logger.log('Job refresh scheduler inactive — Adzuna credentials not set');
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

  /** Refresh Adzuna jobs for a single tenant (portal manual refresh). */
  async runForUser(userId: number): Promise<{ expired: number; fetched: number }> {
    this.logger.log(`Job refresh starting for userId=${userId}…`);
    const expired = await this.fetcher.expireStaleJobs(30);

    let fetched = 0;
    for (const keyword of REFRESH_KEYWORDS) {
      try {
        fetched += await this.fetcher.fetchAndStore(userId, keyword, 'india', 1);
      } catch (e: any) {
        this.logger.warn(`Refresh failed userId=${userId} keyword="${keyword}": ${e.message}`);
      }
    }

    this.logger.log(`Job refresh complete userId=${userId} — expired=${expired} fetched=${fetched}`);
    return { expired, fetched };
  }

  /** Scheduled refresh for all career_ai tenants. */
  async run(): Promise<{ expired: number; fetched: number }> {
    this.logger.log('Job refresh cycle starting…');

    // Expire stale Adzuna jobs older than 30 days across all tenants.
    const expired = await this.fetcher.expireStaleJobs(30);

    // Find all tenants using the career_ai business category.
    const settings = await this.prisma.userSetting.findMany({
      where: { key: 'business_category', value: 'career_ai' },
      select: { userId: true },
    });

    let fetched = 0;
    for (const { userId } of settings) {
      for (const keyword of REFRESH_KEYWORDS) {
        try {
          // Fetch 1 page (20 results) per keyword — keeps request count low.
          fetched += await this.fetcher.fetchAndStore(userId, keyword, 'india', 1);
        } catch (e: any) {
          this.logger.warn(
            `Refresh failed userId=${userId} keyword="${keyword}": ${e.message}`,
          );
        }
      }
    }

    this.logger.log(`Job refresh complete — expired=${expired} fetched=${fetched}`);
    return { expired, fetched };
  }
}
