import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';
import { CareerTenantSettingsService } from '../services/career-tenant-settings.service';

/**
 * LinkedIn Jobs adapter — requires a partner/scraper HTTP endpoint.
 * Configure URL + API key per operator in Settings → CareerAI.
 */
@Injectable()
export class LinkedInJobSource implements CareerJobSource {
  readonly id = 'linkedin';
  readonly name = 'LinkedIn Jobs';

  private readonly logger = new Logger(LinkedInJobSource.name);

  constructor(
    private readonly tenantSettings: CareerTenantSettingsService,
    private readonly upsert: CareerJobUpsertService,
  ) {}

  async isEnabled(userId: number): Promise<boolean> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    return !!(cfg.linkedinApiUrl && cfg.linkedinApiKey);
  }

  async getStatus(userId: number): Promise<JobSourceStatus> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    const enabled = !!(cfg.linkedinApiUrl && cfg.linkedinApiKey);
    return {
      id: this.id,
      name: this.name,
      enabled,
      message: enabled
        ? `Connected to ${cfg.linkedinApiUrl}`
        : 'Add LinkedIn Jobs API URL & key in Settings → CareerAI',
    };
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 1,
  ): Promise<number> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    if (!cfg.linkedinApiUrl || !cfg.linkedinApiKey) {
      return 0;
    }

    try {
      const { data } = await axios.get<{ jobs?: Record<string, unknown>[] }>(cfg.linkedinApiUrl, {
        params: { keyword, location, pages },
        headers: { Authorization: `Bearer ${cfg.linkedinApiKey}` },
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
      throw e;
    }
  }

  private normalize(raw: Record<string, unknown>): NormalizedJobListing | null {
    const id = String(raw.id ?? raw.job_id ?? '').trim();
    const title = String(raw.title ?? raw.job_title ?? '').trim();
    const company = String(raw.company ?? raw.company_name ?? '').trim();
    if (!id || !title || !company) return null;

    return {
      externalId: id,
      title,
      company,
      location: raw.location ? String(raw.location) : null,
      description: raw.description ? String(raw.description) : null,
      applyUrl: raw.apply_url ? String(raw.apply_url) : null,
    };
  }
}
