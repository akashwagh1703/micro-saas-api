import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';

/**
 * LinkedIn Jobs adapter — requires a partner/scraper HTTP endpoint (LinkedIn has no public job search API).
 * Set LINKEDIN_JOBS_API_URL + LINKEDIN_JOBS_API_KEY when available.
 */
@Injectable()
export class LinkedInJobSource implements CareerJobSource {
  readonly id = 'linkedin';
  readonly name = 'LinkedIn Jobs';

  private readonly logger = new Logger(LinkedInJobSource.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly upsert: CareerJobUpsertService,
  ) {
    this.apiUrl = config.get<string>('LINKEDIN_JOBS_API_URL')?.trim() ?? '';
    this.apiKey = config.get<string>('LINKEDIN_JOBS_API_KEY')?.trim() ?? '';
  }

  isEnabled(): boolean {
    return !!(this.apiUrl && this.apiKey);
  }

  getStatus(): JobSourceStatus {
    return {
      id: this.id,
      name: this.name,
      enabled: this.isEnabled(),
      message: this.isEnabled()
        ? `Connected to ${this.apiUrl}`
        : 'Set LINKEDIN_JOBS_API_URL and LINKEDIN_JOBS_API_KEY (partner/scraper feed)',
    };
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 1,
  ): Promise<number> {
    if (!this.isEnabled()) return 0;

    try {
      const { data } = await axios.get<{ jobs?: Record<string, unknown>[] }>(this.apiUrl, {
        params: { keyword, location, pages },
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 20_000,
      });

      let stored = 0;
      for (const raw of data.jobs ?? []) {
        const listing = this.normalize(raw);
        if (!listing) continue;
        try {
          await this.upsert.upsert(userId, this.id, listing);
          stored++;
        } catch (e: any) {
          this.logger.warn(`Skipped LinkedIn job: ${e.message}`);
        }
      }

      this.logger.log(`LinkedIn: stored ${stored} jobs for userId=${userId}`);
      return stored;
    } catch (e: any) {
      this.logger.warn(`LinkedIn fetch failed: ${e.message}`);
      return 0;
    }
  }

  private normalize(raw: Record<string, unknown>): NormalizedJobListing | null {
    const id = String(raw.id ?? raw.job_id ?? '').trim();
    const title = String(raw.title ?? '').trim();
    const company = String(raw.company ?? raw.company_name ?? '').trim();
    if (!id || !title || !company) return null;

    return {
      externalId: `linkedin_${id}`,
      title,
      company,
      location: raw.location ? String(raw.location) : null,
      description: raw.description ? String(raw.description) : null,
      applyUrl: raw.apply_url ? String(raw.apply_url) : raw.url ? String(raw.url) : null,
      tags: ['linkedin'],
    };
  }
}
