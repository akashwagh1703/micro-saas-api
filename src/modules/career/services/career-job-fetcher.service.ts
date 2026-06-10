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
 * Orchestrates job fetching across Adzuna, JSearch, Naukri, LinkedIn (per-tenant credentials).
 */
@Injectable()
export class CareerJobFetcherService {
  private readonly logger = new Logger(CareerJobFetcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CareerJobSourceRegistry,
  ) {}

  async isEnabled(userId: number): Promise<boolean> {
    return this.registry.anyEnabled(userId);
  }

  async listSources(userId: number): Promise<JobSourceStatus[]> {
    return this.registry.statuses(userId);
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
    let sources = await this.registry.enabled(userId);

    if (sourceId) {
      const one = this.registry.get(sourceId);
      sources =
        one && (await one.isEnabled(userId)) ? [one] : [];
    }

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
      this.logger.warn(`Source ${source.id} failed for userId=${userId}: ${message}`);
    }

    return {
      total,
      bySource,
      enabledSources: sources.map((s) => s.id),
      errors,
    };
  }

  async expireStaleJobs(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await this.prisma.careerJob.updateMany({
      where: {
        isActive: true,
        source: { in: [...EXTERNAL_JOB_SOURCES] },
        updatedAt: { lt: cutoff },
      },
      data: { isActive: false },
    });

    return result.count;
  }

  async findJobsCreatedSince(userId: number, since: Date): Promise<number[]> {
    const rows = await this.prisma.careerJob.findMany({
      where: {
        userId,
        isActive: true,
        createdAt: { gte: since },
        source: { in: [...EXTERNAL_JOB_SOURCES] },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
