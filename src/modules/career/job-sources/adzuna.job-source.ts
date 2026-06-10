import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';
import { CareerTenantSettingsService } from '../services/career-tenant-settings.service';
import {
  formatHttpError,
  formatSalaryInr,
  formatUpsertError,
  extractSkillsFromDescription,
  normalizeContractType,
  parseExperienceRange,
} from './job-source.utils';

interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string; area?: string[] };
  description: string;
  salary_min?: number;
  salary_max?: number;
  contract_type?: string;
  redirect_url: string;
  created: string;
  category?: { label: string };
}

@Injectable()
export class AdzunaJobSource implements CareerJobSource {
  readonly id = 'adzuna';
  readonly name = 'Adzuna India';

  private readonly logger = new Logger(AdzunaJobSource.name);

  constructor(
    private readonly tenantSettings: CareerTenantSettingsService,
    private readonly upsert: CareerJobUpsertService,
  ) {}

  async isEnabled(userId: number): Promise<boolean> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    return !!(cfg.adzunaAppId && cfg.adzunaAppKey);
  }

  async getStatus(userId: number): Promise<JobSourceStatus> {
    const enabled = await this.isEnabled(userId);
    return {
      id: this.id,
      name: this.name,
      enabled,
      message: enabled
        ? 'Live job listings via Adzuna API'
        : 'Add Adzuna App ID & Key in Settings → CareerAI',
    };
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 2,
  ): Promise<number> {
    const cfg = await this.tenantSettings.getJobSourcesConfig(userId);
    if (!cfg.adzunaAppId || !cfg.adzunaAppKey) {
      return 0;
    }

    let stored = 0;
    let lastError: string | null = null;

    for (let page = 1; page <= pages; page++) {
      try {
        const { data } = await axios.get<{ results: AdzunaJob[] }>(
          `https://api.adzuna.com/v1/api/jobs/in/search/${page}`,
          {
            params: {
              app_id: cfg.adzunaAppId,
              app_key: cfg.adzunaAppKey,
              results_per_page: 20,
              what: keyword,
              where: location,
              'content-type': 'application/json',
            },
            timeout: 15_000,
          },
        );

        for (const job of data.results ?? []) {
          try {
            await this.upsert.upsert(userId, this.id, this.normalize(job));
            stored++;
          } catch (e: unknown) {
            this.logger.warn(`Skipped Adzuna job ${job.id}: ${formatUpsertError(e)}`);
          }
        }
      } catch (e: unknown) {
        lastError = formatHttpError(e);
        this.logger.warn(`Adzuna fetch failed (keyword="${keyword}" page=${page}): ${lastError}`);
      }
    }

    if (stored === 0 && lastError) {
      throw new Error(lastError);
    }

    this.logger.log(`Adzuna: stored ${stored} jobs for userId=${userId} keyword="${keyword}"`);
    return stored;
  }

  private normalize(job: AdzunaJob): NormalizedJobListing {
    const description = job.description ?? '';
    const salaryMin = job.salary_min ? Math.round(job.salary_min) : null;
    const salaryMax = job.salary_max ? Math.round(job.salary_max) : null;
    const expRange = parseExperienceRange(description);
    const tags: string[] = [];
    if (job.category?.label) tags.push(job.category.label);
    if (job.contract_type) tags.push(job.contract_type);
    const title = job.title?.trim() || 'Untitled role';

    return {
      externalId: String(job.id),
      title,
      company: job.company?.display_name?.trim() || 'Unknown company',
      location: job.location?.display_name ?? null,
      city: job.location?.area?.[1] ?? job.location?.display_name ?? null,
      description,
      salaryMin,
      salaryMax,
      salaryText: formatSalaryInr(salaryMin, salaryMax),
      jobType: normalizeContractType(job.contract_type),
      applyUrl: job.redirect_url,
      postedAt: job.created ? new Date(job.created) : null,
      industry: job.category?.label ?? null,
      tags,
      requiredSkills: extractSkillsFromDescription(description, title),
      minExperience: expRange.min ?? null,
      experienceMax: expRange.max ?? null,
    };
  }
}
