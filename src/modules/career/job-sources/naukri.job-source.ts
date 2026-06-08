import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';

/**
 * Naukri adapter — calls a configurable HTTP JSON API (your scraper, partner feed, or RapidAPI proxy).
 * Set NAUKRI_JOBS_API_URL + NAUKRI_JOBS_API_KEY when you have an integration endpoint.
 *
 * Expected response shape: { jobs: Array<{ id, title, company, location?, description?, apply_url?, salary_text? }> }
 */
@Injectable()
export class NaukriJobSource implements CareerJobSource {
  readonly id = 'naukri';
  readonly name = 'Naukri';

  private readonly logger = new Logger(NaukriJobSource.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly upsert: CareerJobUpsertService,
  ) {
    this.apiUrl = config.get<string>('NAUKRI_JOBS_API_URL')?.trim() ?? '';
    this.apiKey = config.get<string>('NAUKRI_JOBS_API_KEY')?.trim() ?? '';
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
        : 'Set NAUKRI_JOBS_API_URL and NAUKRI_JOBS_API_KEY for Naukri listings',
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
          this.logger.warn(`Skipped Naukri job: ${e.message}`);
        }
      }

      this.logger.log(`Naukri: stored ${stored} jobs for userId=${userId}`);
      return stored;
    } catch (e: any) {
      this.logger.warn(`Naukri fetch failed: ${e.message}`);
      return 0;
    }
  }

  private normalize(raw: Record<string, unknown>): NormalizedJobListing | null {
    const id = String(raw.id ?? raw.job_id ?? '').trim();
    const title = String(raw.title ?? '').trim();
    const company = String(raw.company ?? raw.company_name ?? '').trim();
    if (!id || !title || !company) return null;

    return {
      externalId: `naukri_${id}`,
      title,
      company,
      location: raw.location ? String(raw.location) : null,
      description: raw.description ? String(raw.description) : null,
      applyUrl: raw.apply_url ? String(raw.apply_url) : raw.url ? String(raw.url) : null,
      salaryText: raw.salary_text ? String(raw.salary_text) : null,
      tags: ['naukri'],
    };
  }
}
