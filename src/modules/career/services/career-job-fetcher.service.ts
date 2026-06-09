import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerJobSourceRegistry } from '../job-sources/career-job-source.registry';
import { EXTERNAL_JOB_SOURCES } from '../job-sources/job-source.utils';
import { JobSourceStatus } from '../job-sources/job-source.types';

export interface FetchJobsResult {
  total: number;
  bySource: Record<string, number>;
  enabledSources: string[];
  errors: Record<string, string>;
}

/**
 * Orchestrates job fetching across Adzuna, JSearch, Naukri, LinkedIn (and future sources).
 */
@Injectable()
export class CareerJobFetcherService {
  private readonly logger = new Logger(CareerJobFetcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CareerJobSourceRegistry,
  ) {}

  isEnabled(): boolean {
    return this.registry.anyEnabled();
  }

  listSources(): JobSourceStatus[] {
    return this.registry.statuses();
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 2,
    sourceId?: string,
  ): Promise<number> {
    const result = await this.fetchAndStoreDetailed(userId, keyword, location, pages, sourceId);
    return result.total;
  }

  async fetchAndStoreDetailed(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 2,
    sourceId?: string,
  ): Promise<FetchJobsResult> {
    const sources = sourceId
      ? [this.registry.get(sourceId)].filter((s): s is NonNullable<typeof s> => !!s?.isEnabled())
      : this.registry.enabled();

    const bySource: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let total = 0;

    if (sources.length === 0) {
      return { total: 0, bySource, enabledSources: [], errors };
    }

    const results = await Promise.allSettled(
      sources.map(async (source) => {
        const count = await source.fetchAndStore(userId, keyword, location, pages);
        return { id: source.id, count };
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const source = sources[i];
      const outcome = results[i];
      if (outcome.status === 'fulfilled') {
        bySource[outcome.value.id] = outcome.value.count;
        total += outcome.value.count;
        continue;
      }
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      errors[source.id] = message;
      bySource[source.id] = 0;
      this.logger.error(
        `Job source "${source.id}" failed for userId=${userId} keyword="${keyword}": ${message}`,
      );
    }

    this.logger.log(
      `Fetched ${total} jobs for userId=${userId} keyword="${keyword}" — ${sources
        .map((s) => `${s.id}:${bySource[s.id] ?? 0}`)
        .join(', ')}`,
    );

    return {
      total,
      bySource,
      enabledSources: sources.map((s) => s.id),
      errors,
    };
  }

  /** Job rows created during a refresh/fetch window (for instant match alerts). */
  async findJobsCreatedSince(userId: number, since: Date): Promise<number[]> {
    const rows = await this.prisma.careerJob.findMany({
      where: {
        userId,
        isActive: true,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async expireStaleJobs(olderThanDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.prisma.careerJob.updateMany({
      where: {
        source: { in: [...EXTERNAL_JOB_SOURCES] },
        isActive: true,
        createdAt: { lt: cutoff },
      },
      data: { isActive: false },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} stale external jobs`);
    }
    return result.count;
  }
}
