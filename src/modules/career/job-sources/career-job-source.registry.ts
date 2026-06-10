import { Injectable } from '@nestjs/common';
import { CareerJobSource, JobSourceStatus } from './job-source.types';
import { AdzunaJobSource } from './adzuna.job-source';
import { JSearchJobSource } from './jsearch.job-source';
import { NaukriJobSource } from './naukri.job-source';
import { LinkedInJobSource } from './linkedin.job-source';

@Injectable()
export class CareerJobSourceRegistry {
  private readonly sources: CareerJobSource[];

  constructor(
    adzuna: AdzunaJobSource,
    jsearch: JSearchJobSource,
    naukri: NaukriJobSource,
    linkedin: LinkedInJobSource,
  ) {
    this.sources = [adzuna, jsearch, naukri, linkedin];
  }

  all(): CareerJobSource[] {
    return this.sources;
  }

  async enabled(userId: number): Promise<CareerJobSource[]> {
    const checks = await Promise.all(
      this.sources.map(async (source) => ((await source.isEnabled(userId)) ? source : null)),
    );
    return checks.filter((s): s is CareerJobSource => s !== null);
  }

  get(id: string): CareerJobSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  async statuses(userId: number): Promise<JobSourceStatus[]> {
    return Promise.all(this.sources.map((s) => s.getStatus(userId)));
  }

  async anyEnabled(userId: number): Promise<boolean> {
    const list = await this.enabled(userId);
    return list.length > 0;
  }
}
