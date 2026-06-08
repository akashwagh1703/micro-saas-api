import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerJobSourceRegistry } from '../job-sources/career-job-source.registry';
import { EXTERNAL_JOB_SOURCES } from '../job-sources/job-source.utils';
import { JobSourceStatus } from '../job-sources/job-source.types';

/**
 * Orchestrates job fetching across Adzuna, Naukri, LinkedIn (and future sources).
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
    const sources = sourceId
      ? [this.registry.get(sourceId)].filter((s): s is NonNullable<typeof s> => !!s?.isEnabled())
      : this.registry.enabled();

    if (sources.length === 0) {
      return 0;
    }

    let stored = 0;
    for (const source of sources) {
      stored += await source.fetchAndStore(userId, keyword, location, pages);
    }

    this.logger.log(
      `Fetched ${stored} jobs for userId=${userId} keyword="${keyword}" from ${sources.map((s) => s.id).join(',')}`,
    );
    return stored;
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
