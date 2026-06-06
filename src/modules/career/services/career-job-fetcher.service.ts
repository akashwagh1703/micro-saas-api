import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import axios from 'axios';

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

/**
 * Fetches real job listings from the Adzuna API (free tier: 250 req/day).
 * Register at https://developer.adzuna.com/ to get ADZUNA_APP_ID and ADZUNA_APP_KEY.
 *
 * When env vars are absent the service is disabled and all methods return 0
 * safely — the rest of the system degrades to the 5 seed jobs.
 */
@Injectable()
export class CareerJobFetcherService {
  private readonly logger = new Logger(CareerJobFetcherService.name);
  private readonly appId: string;
  private readonly appKey: string;
  private readonly enabled: boolean;

  // Skills we scan job descriptions for so we can populate requiredSkills.
  private static readonly SKILL_LIST = [
    'react', 'angular', 'vue', 'nodejs', 'node.js', 'nestjs', 'express',
    'typescript', 'javascript', 'python', 'java', 'php', 'laravel', 'django',
    'postgresql', 'mysql', 'mongodb', 'redis', 'aws', 'azure', 'gcp',
    'docker', 'kubernetes', 'git', 'html', 'css', 'tailwind', 'graphql',
    'rest', 'sql', 'linux', 'flutter', 'react native', 'kotlin', 'swift',
    'figma', 'excel', 'tally', 'salesforce', 'sap', 'photoshop',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.appId  = config.get<string>('ADZUNA_APP_ID')  ?? '';
    this.appKey = config.get<string>('ADZUNA_APP_KEY') ?? '';
    this.enabled = !!(this.appId && this.appKey);

    if (!this.enabled) {
      this.logger.log('CareerJobFetcher disabled — ADZUNA_APP_ID / ADZUNA_APP_KEY not set');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Fetches `pages` pages of results for `keyword` from Adzuna India,
   * upserts each job under `userId`, and returns the total count stored.
   */
  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 2,
  ): Promise<number> {
    if (!this.enabled) return 0;

    let stored = 0;
    for (let page = 1; page <= pages; page++) {
      try {
        const { data } = await axios.get<{ results: AdzunaJob[] }>(
          `https://api.adzuna.com/v1/api/jobs/in/search/${page}`,
          {
            params: {
              app_id: this.appId,
              app_key: this.appKey,
              results_per_page: 20,
              what: keyword,
              where: location,
              content_type: 'application/json',
            },
            timeout: 15_000,
          },
        );

        for (const job of data.results ?? []) {
          try {
            await this.upsertJob(userId, job);
            stored++;
          } catch (e: any) {
            this.logger.warn(`Skipped job ${job.id}: ${e.message}`);
          }
        }
      } catch (e: any) {
        this.logger.warn(`Adzuna fetch failed (keyword="${keyword}" page=${page}): ${e.message}`);
      }
    }

    this.logger.log(`Fetched ${stored} jobs for userId=${userId} keyword="${keyword}"`);
    return stored;
  }

  /** Expire jobs older than `days` days that came from Adzuna. */
  async expireStaleJobs(olderThanDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.prisma.careerJob.updateMany({
      where: {
        source: 'adzuna',
        isActive: true,
        createdAt: { lt: cutoff },
      },
      data: { isActive: false },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} stale Adzuna jobs`);
    }
    return result.count;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async upsertJob(userId: number, job: AdzunaJob): Promise<void> {
    const skills    = this.extractSkills(job.description ?? '');
    const city      = job.location?.area?.[1] ?? job.location?.display_name ?? null;
    const salaryMin = job.salary_min ? Math.round(job.salary_min) : null;
    const salaryMax = job.salary_max ? Math.round(job.salary_max) : null;

    // Prisma upsert requires the @@unique([userId, externalId]) constraint added in migration.
    // We guard with a try/catch in the caller to skip duplicates if the constraint
    // doesn't exist yet (e.g. first deploy before migration runs).
    await this.prisma.careerJob.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userId_externalId: { userId, externalId: job.id } as any,
      },
      create: {
        userId,
        title:         job.title,
        company:       job.company.display_name,
        location:      job.location.display_name,
        city,
        salaryMin,
        salaryMax,
        salaryText:    this.formatSalary(salaryMin, salaryMax),
        jobType:       this.normalizeContractType(job.contract_type),
        description:   (job.description ?? '').slice(0, 3000),
        requiredSkills: skills,
        applyUrl:      job.redirect_url,
        postedAt:      job.created ? new Date(job.created) : null,
        expiresAt:     this.thirtyDaysFromNow(),
        industry:      job.category?.label ?? null,
        source:        'adzuna',
        externalId:    job.id,
        isActive:      true,
      },
      update: {
        title:         job.title,
        salaryMin,
        salaryMax,
        salaryText:    this.formatSalary(salaryMin, salaryMax),
        description:   (job.description ?? '').slice(0, 3000),
        requiredSkills: skills,
        expiresAt:     this.thirtyDaysFromNow(),
        isActive:      true,
      },
    });
  }

  private extractSkills(description: string): string[] {
    const lower = description.toLowerCase();
    return CareerJobFetcherService.SKILL_LIST.filter((s) => lower.includes(s));
  }

  private formatSalary(min: number | null, max: number | null): string | null {
    if (!min && !max) return null;
    // Adzuna UK API returns annual GBP; India API returns annual INR.
    // Values > 100 000 are assumed raw INR — convert to LPA display.
    const toDisplay = (n: number) =>
      n > 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : `₹${n.toLocaleString()}`;
    if (min && max) return `${toDisplay(min)}–${toDisplay(max)} PA`;
    if (min) return `${toDisplay(min)}+ PA`;
    return null;
  }

  private normalizeContractType(ct?: string): string | null {
    if (!ct) return null;
    const m = ct.toLowerCase();
    if (m.includes('full')) return 'full_time';
    if (m.includes('part')) return 'part_time';
    if (m.includes('contract') || m.includes('freelance')) return 'contract';
    return m;
  }

  private thirtyDaysFromNow(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  }
}
