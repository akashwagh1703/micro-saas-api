import { Injectable } from '@nestjs/common';
import { CareerJobSource, JobSourceStatus } from './job-source.types';
import { AdzunaJobSource } from './adzuna.job-source';
import { NaukriJobSource } from './naukri.job-source';
import { LinkedInJobSource } from './linkedin.job-source';

@Injectable()
export class CareerJobSourceRegistry {
  private readonly sources: CareerJobSource[];

  constructor(
    adzuna: AdzunaJobSource,
    naukri: NaukriJobSource,
    linkedin: LinkedInJobSource,
  ) {
    this.sources = [adzuna, naukri, linkedin];
  }

  all(): CareerJobSource[] {
    return this.sources;
  }

  enabled(): CareerJobSource[] {
    return this.sources.filter((s) => s.isEnabled());
  }

  get(id: string): CareerJobSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  statuses(): JobSourceStatus[] {
    return this.sources.map((s) => s.getStatus());
  }

  anyEnabled(): boolean {
    return this.enabled().length > 0;
  }
}
