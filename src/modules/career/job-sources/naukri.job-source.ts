import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { assertAllowedUrl, guardedHttpAgents } from '../../../common/net/ssrf-guard';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';
import { CareerTenantSettingsService } from '../services/career-tenant-settings.service';

/**
 * Naukri adapter — calls a configurable HTTP JSON API (your scraper, partner feed, or RapidAPI proxy).
 * Configure URL + API key per operator in Settings → CareerAI.
 */
@Injectable()
export class NaukriJobSource implements CareerJobSource {
  readonly id = 'naukri';
  readonly name = 'Naukri';

  private readonly logger = new Logger(NaukriJobSource.name);

  constructor(
    private readonly tenantSettings: CareerTenantSettingsService,
    private readonly upsert: CareerJobUpsertService,
  ) {}

  async isEnabled(userId: number): Promise<boolean> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    return !!(cfg.naukriApiUrl && cfg.naukriApiKey);
  }

  async getStatus(userId: number): Promise<JobSourceStatus> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    const enabled = !!(cfg.naukriApiUrl && cfg.naukriApiKey);
    return {
      id: this.id,
      name: this.name,
      enabled,
      message: enabled
        ? `Connected to ${cfg.naukriApiUrl}`
        : 'Add Naukri API URL & key in Settings → CareerAI',
    };
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 1,
  ): Promise<number> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    if (!cfg.naukriApiUrl || !cfg.naukriApiKey) {
      return 0;
    }

    assertAllowedUrl(cfg.naukriApiUrl);
    const { httpAgent, httpsAgent } = guardedHttpAgents();

    try {
      const { data } = await axios.get<{ jobs?: Record<string, unknown>[] }>(cfg.naukriApiUrl, {
        params: { keyword, location, pages },
        headers: { Authorization: `Bearer ${cfg.naukriApiKey}` },
        timeout: 20_000,
        httpAgent,
        httpsAgent,
        maxRedirects: 3,
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
      salaryText: raw.salary_text ? String(raw.salary_text) : null,
      applyUrl: raw.apply_url ? String(raw.apply_url) : null,
    };
  }
}
