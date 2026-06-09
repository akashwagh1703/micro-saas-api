import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CareerJobSource, JobSourceStatus, NormalizedJobListing } from './job-source.types';
import { CareerJobUpsertService } from './career-job-upsert.service';
import {
  extractSkillsFromDescription,
  formatHttpError,
  formatUpsertError,
  normalizeContractType,
} from './job-source.utils';

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const SEARCH_URL = `https://${JSEARCH_HOST}/search`;

interface JSearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_location?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_description?: string;
  job_apply_link?: string;
  job_employment_type?: string;
  job_is_remote?: boolean | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_posted_at_datetime_utc?: string | null;
  work_arrangement?: string | null;
  required_experience_years?: number | null;
  preferred_technologies?: string[];
  required_technologies?: string[];
  industry?: string | null;
  job_publisher?: string | null;
}

@Injectable()
export class JSearchJobSource implements CareerJobSource {
  readonly id = 'jsearch';
  readonly name = 'JSearch (Google Jobs)';

  private readonly logger = new Logger(JSearchJobSource.name);
  private readonly apiKey: string;
  private readonly defaultCountry: string;
  private readonly maxPages: number;

  constructor(
    private readonly config: ConfigService,
    private readonly upsert: CareerJobUpsertService,
  ) {
    this.apiKey = config.get<string>('JSEARCH_RAPIDAPI_KEY')?.trim() ?? '';
    this.defaultCountry = (config.get<string>('JSEARCH_DEFAULT_COUNTRY') ?? 'in')
      .trim()
      .toLowerCase()
      .slice(0, 2);
    const maxPagesRaw = parseInt(config.get<string>('JSEARCH_MAX_PAGES') ?? '1', 10);
    this.maxPages = Number.isNaN(maxPagesRaw) ? 1 : Math.min(Math.max(maxPagesRaw, 1), 3);
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  getStatus(): JobSourceStatus {
    return {
      id: this.id,
      name: this.name,
      enabled: this.isEnabled(),
      message: this.isEnabled()
        ? `RapidAPI JSearch · default country ${this.defaultCountry.toUpperCase()}`
        : 'Set JSEARCH_RAPIDAPI_KEY in API env (RapidAPI → JSearch)',
    };
  }

  async fetchAndStore(
    userId: number,
    keyword: string,
    location = 'india',
    pages = 1,
  ): Promise<number> {
    if (!this.isEnabled()) return 0;

    const country = this.resolveCountry(location);
    const query = this.buildQuery(keyword, location, country);
    const numPages = Math.min(Math.max(pages, 1), this.maxPages);

    let stored = 0;
    try {
      const { data } = await axios.get<{ data?: JSearchJob[] }>(SEARCH_URL, {
        params: {
          query,
          page: 1,
          num_pages: numPages,
          country,
          date_posted: 'month',
        },
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': JSEARCH_HOST,
        },
        timeout: 25_000,
      });

      for (const job of data.data ?? []) {
        const listing = this.normalize(job, country);
        if (!listing) continue;
        try {
          await this.upsert.upsert(userId, this.id, listing);
          stored++;
        } catch (e: unknown) {
          this.logger.warn(`Skipped JSearch job ${job.job_id}: ${formatUpsertError(e)}`);
        }
      }
    } catch (e: unknown) {
      const message = formatHttpError(e);
      this.logger.warn(`JSearch fetch failed (query="${query}" country=${country}): ${message}`);
      throw new Error(message);
    }

    this.logger.log(
      `JSearch: stored ${stored} jobs for userId=${userId} query="${query}" country=${country}`,
    );
    return stored;
  }

  /** Maps portal location input to JSearch ISO country code. */
  private resolveCountry(location: string): string {
    const lower = (location ?? '').trim().toLowerCase();
    if (!lower || lower === 'india' || lower === 'in') return 'in';
    if (lower === 'us' || lower === 'usa' || lower.includes('united states')) return 'us';
    if (lower === 'uk' || lower.includes('united kingdom')) return 'gb';
    if (lower.length === 2) return lower;
    if (lower.includes('india')) return 'in';
    return this.defaultCountry;
  }

  /** e.g. "React Developer" + "Pune" → "React Developer in Pune". */
  private buildQuery(keyword: string, location: string, country: string): string {
    const kw = keyword.trim();
    const loc = location.trim();
    const generic = ['india', 'in', 'us', 'usa', 'uk', country].includes(loc.toLowerCase());
    if (!loc || generic) {
      return kw;
    }
    if (kw.toLowerCase().includes(loc.toLowerCase())) {
      return kw;
    }
    return `${kw} in ${loc}`;
  }

  private normalize(job: JSearchJob, searchCountry: string): NormalizedJobListing | null {
    const id = String(job.job_id ?? '').trim();
    const title = String(job.job_title ?? '').trim();
    const company = String(job.employer_name ?? '').trim();
    if (!id || !title || !company) return null;

    const description = job.job_description?.trim() ?? '';
    const country = (job.job_country ?? searchCountry).toUpperCase();
    const locationParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
    const location = job.job_location ?? (locationParts.length > 0 ? locationParts.join(', ') : null);

    const techSkills = [
      ...(job.preferred_technologies ?? []),
      ...(job.required_technologies ?? []),
    ].map((s) => s.toLowerCase().trim());
    const descSkills = extractSkillsFromDescription(description);
    const requiredSkills = [...new Set([...techSkills, ...descSkills])].slice(0, 20);

    const salary = this.formatSalary(job, country);
    const jobType = this.resolveJobType(job);
    const minExp = job.required_experience_years ?? null;

    const tags: string[] = [];
    if (job.job_publisher) tags.push(job.job_publisher);
    if (job.industry) tags.push(job.industry);

    return {
      externalId: id,
      title,
      company,
      location,
      city: job.job_city ?? null,
      description: description || null,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryText: salary.text,
      jobType,
      applyUrl: job.job_apply_link ?? null,
      postedAt: job.job_posted_at_datetime_utc
        ? new Date(job.job_posted_at_datetime_utc)
        : null,
      industry: job.industry ?? null,
      tags,
      requiredSkills,
      minExperience: minExp,
      experienceMax: minExp != null ? minExp + 5 : null,
    };
  }

  private formatSalary(
    job: JSearchJob,
    country: string,
  ): { min: number | null; max: number | null; text: string | null } {
    const min = job.job_min_salary ?? null;
    const max = job.job_max_salary ?? null;
    if (min == null && max == null) return { min: null, max: null, text: null };

    const period = (job.job_salary_period ?? 'YEAR').toLowerCase();

    // India: small values are usually LPA; large values are raw INR.
    if (country === 'IN') {
      const toLpa = (n: number) => (n > 500 ? Math.round((n / 100_000) * 10) / 10 : n);
      const minL = min != null ? toLpa(min) : null;
      const maxL = max != null ? toLpa(max) : null;
      const text =
        minL != null && maxL != null
          ? `₹${minL}–${maxL} LPA`
          : minL != null
            ? `₹${minL}+ LPA`
            : null;
      return { min: minL, max: maxL, text };
    }

    // US/others: keep numeric fields null — matching uses salaryText; avoids USD→LPA bugs.
    const fmt = (n: number) => n.toLocaleString('en-US');
    const suffix = period.includes('year') ? '/yr' : period.includes('hour') ? '/hr' : '';
    const text =
      min != null && max != null
        ? `$${fmt(min)}–$${fmt(max)}${suffix}`
        : min != null
          ? `$${fmt(min)}+${suffix}`
          : null;
    return { min: null, max: null, text };
  }

  private resolveJobType(job: JSearchJob): string | null {
    if (job.job_is_remote === true) return 'remote';
    const arrangement = (job.work_arrangement ?? '').toLowerCase();
    if (arrangement.includes('remote')) return 'remote';
    if (arrangement.includes('hybrid')) return 'hybrid';
    if (arrangement.includes('onsite') || arrangement.includes('on-site')) return 'onsite';
    return normalizeContractType(job.job_employment_type);
  }
}
