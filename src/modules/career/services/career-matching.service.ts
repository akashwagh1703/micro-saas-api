import { Injectable } from '@nestjs/common';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeSkillToken } from '../job-sources/job-source.utils';
import { CareerJobService } from './career-job.service';

export interface JobMatchResult {
  job: CareerJob;
  score: number;
  matchFactors: string[];
  missingSkills: string[];
}

export type MatchTier = 'strong' | 'good' | 'stretch';

/** Instant alerts & daily digest (high-confidence only). */
export const CAREER_MATCH_TIER_STRONG = 80;

/** VIEW JOBS, FIND JOBS, onboarding. */
export const CAREER_MATCH_TIER_GOOD = 65;

/** Optional explore band — not pushed via alerts. */
export const CAREER_MATCH_TIER_STRETCH = 50;

export function minScoreForTier(tier: MatchTier): number {
  switch (tier) {
    case 'strong':
      return CAREER_MATCH_TIER_STRONG;
    case 'good':
      return CAREER_MATCH_TIER_GOOD;
    case 'stretch':
      return CAREER_MATCH_TIER_STRETCH;
  }
}

export interface MatchPipelineOptions {
  /** Keyword search instead of profile-based pre-filter. */
  keyword?: string;
  /** Minimum score to return in `shown` (default: good tier). */
  tier?: MatchTier;
}

export interface MatchPipelineResult {
  allMatches: JobMatchResult[];
  shownMatches: JobMatchResult[];
}

/**
 * Scoring weights — must sum to 100.
 *
 *  Skills         40 pts  — primary technical fit signal
 *  Experience     20 pts  — years vs job minimum requirement
 *  Salary         15 pts  — candidate expectation vs job range
 *  Location       15 pts  — preferred locations vs job city / remote flag
 *  Role title      5 pts  — preferred roles vs job title
 *  Notice period   5 pts  — candidate availability vs job urgency
 */
const W_SKILLS     = 40;
const W_EXPERIENCE = 20;
const W_SALARY     = 15;
const W_LOCATION   = 15;
const W_ROLE       = 5;
const W_NOTICE     = 5;

/** Minimum score shown to job seekers in VIEW JOBS / FIND JOBS. */
export const CAREER_MIN_MATCH_SCORE = CAREER_MATCH_TIER_GOOD;

/** Human-readable match band aligned with CareerAI.md Step 6. */
export function formatMatchScoreLabel(score: number): string {
  if (score >= 95) return 'Excellent Match';
  if (score >= CAREER_MATCH_TIER_STRONG) return 'Strong Match';
  if (score >= CAREER_MATCH_TIER_GOOD) return 'Good Match';
  if (score >= CAREER_MATCH_TIER_STRETCH) return 'Partial Match';
  return 'Low Match';
}

const CITY_ALIASES: Record<string, string[]> = {
  bangalore: ['bangalore', 'bengaluru'],
  bengaluru: ['bangalore', 'bengaluru'],
  mumbai: ['mumbai', 'bombay'],
  bombay: ['mumbai', 'bombay'],
  delhi: ['delhi', 'new delhi', 'ncr'],
  chennai: ['chennai', 'madras'],
  kolkata: ['kolkata', 'calcutta'],
  hyderabad: ['hyderabad'],
  pune: ['pune', 'poona'],
};

@Injectable()
export class CareerMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: CareerJobService,
  ) {}

  filterMatchesByTier(results: JobMatchResult[], tier: MatchTier = 'good'): JobMatchResult[] {
    const min = minScoreForTier(tier);
    return results.filter((r) => r.score >= min);
  }

  /** @deprecated Use filterMatchesByTier(results, 'good') */
  filterQualityMatches(results: JobMatchResult[]): JobMatchResult[] {
    return this.filterMatchesByTier(results, 'good');
  }

  /**
   * Unified matching pipeline: pre-filter → score → persist top 100.
   * Used by bot, digest, alerts, and portal rematch.
   */
  async matchAndPersistForProfile(
    userId: number,
    profile: CareerProfile,
    options: MatchPipelineOptions = {},
  ): Promise<MatchPipelineResult> {
    const tier = options.tier ?? 'good';
    let jobList = await this.jobs.listActive(userId);

    const keyword = options.keyword?.trim();
    if (keyword && keyword.length > 1 && keyword.toLowerCase() !== 'all') {
      jobList = this.jobs.searchByKeyword(jobList, keyword);
    } else {
      jobList = this.jobs.relevantJobsForProfile(jobList, profile);
    }

    const allMatches = this.matchProfileToJobs(profile, jobList);
    await this.persistMatches(userId, profile.id, profile.contactId, allMatches);
    const shownMatches = this.filterMatchesByTier(allMatches, tier);

    return { allMatches, shownMatches };
  }

  matchProfileToJobs(profile: CareerProfile, jobs: CareerJob[]): JobMatchResult[] {
    const profileSkills    = this.normalizeSkills(profile.skills);
    const preferredRoles   = this.normalizeArray(profile.preferredRoles);
    const preferredLocs    = this.buildLocationPreferences(profile);
    const profileExpYears  = this.calcExperienceYears(profile.experience);
    const expectedSalaryL  = this.parseSalaryLPA(profile.expectedSalary);
    const workPref         = (profile.workPreference ?? '').toLowerCase();
    const noticeDays       = this.parseNoticePeriodDays(profile.noticePeriod);

    return jobs
      .map((job) => {
        const matched: string[] = [];
        const missing: string[]  = [];
        let score = 0;

        // ── 1. Skills (40 pts) ───────────────────────────────────────────────
        const required = this.normalizeSkills(job.requiredSkills);
        if (required.length > 0) {
          const hits = required.filter((skill) => this.skillMatches(profileSkills, skill));
          score += (hits.length / required.length) * W_SKILLS;
          hits.forEach((s) => matched.push(`✓ ${this.cap(s)}`));
          required.filter((s) => !hits.includes(s)).forEach((s) => missing.push(this.cap(s)));
        } else {
          // No required skills listed — minimal credit (avoids inflated Adzuna scores).
          score += W_SKILLS * 0.25;
        }

        // ── 2. Experience (20 pts) ───────────────────────────────────────────
        const minExp = job.minExperience ?? 0;
        const maxExp = job.experienceMax ?? 99;
        if (profileExpYears >= minExp && profileExpYears <= maxExp) {
          score += W_EXPERIENCE;
          matched.push(`✓ ${profileExpYears}y exp (needs ${minExp}–${maxExp}y)`);
        } else if (profileExpYears >= minExp && profileExpYears > maxExp) {
          score += W_EXPERIENCE * 0.75;
          matched.push(`✓ ${profileExpYears}y exp (role asks ${minExp}–${maxExp}y)`);
        } else if (profileExpYears >= minExp) {
          score += W_EXPERIENCE * 0.85;
          matched.push(`✓ Experience meets minimum (${minExp}y+)`);
        } else if (minExp > 0) {
          // Partial credit proportional to how close the candidate is.
          const partial = (profileExpYears / minExp) * W_EXPERIENCE * 0.5;
          score += partial;
          missing.push(`${minExp}+ years experience`);
        }

        // ── 3. Salary (15 pts) ───────────────────────────────────────────────
        const jobMinL = this.inrToLPA(job.salaryMin);
        const jobMaxL = this.inrToLPA(job.salaryMax);

        if (expectedSalaryL !== null && jobMinL !== null && jobMaxL !== null) {
          if (expectedSalaryL >= jobMinL && expectedSalaryL <= jobMaxL * 1.15) {
            // Expectation falls within range (with 15% headroom for negotiation).
            score += W_SALARY;
            matched.push(`✓ Salary fits (expect ${expectedSalaryL}L, range ${jobMinL}–${jobMaxL}L)`);
          } else if (expectedSalaryL <= jobMaxL) {
            // Expectation is below max — candidate may accept.
            score += W_SALARY * 0.7;
            matched.push(`✓ Within salary budget`);
          } else {
            // Candidate expects more than the job offers.
            missing.push(`Salary: expect ${expectedSalaryL}L, offered up to ${jobMaxL}L`);
          }
        } else {
          // Salary data missing on one side — neutral half credit.
          score += W_SALARY * 0.5;
        }

        // ── 4. Location (15 pts) ─────────────────────────────────────────────
        const jobCity   = (job.city ?? job.location ?? '').toLowerCase();
        const workMode  = this.getJobWorkMode(job);
        const isRemote  =
          workMode === 'remote' ||
          workMode === 'hybrid' ||
          jobCity.includes('remote');

        if (workPref === 'remote' && isRemote) {
          score += W_LOCATION;
          matched.push(workMode === 'hybrid' ? '✓ Hybrid / remote option' : '✓ Remote role');
        } else if (workPref === 'remote' && !isRemote) {
          // Candidate wants remote, job is not.
          missing.push('Remote role required');
        } else if (preferredLocs.length > 0) {
          const locHit = preferredLocs.some((loc) => this.locationMatches(loc, jobCity));
          if (locHit) {
            score += W_LOCATION;
            matched.push(`✓ Location matches`);
          } else if (isRemote) {
            // Remote is acceptable even when not the preference.
            score += W_LOCATION * 0.6;
            matched.push('✓ Remote option (not preferred city)');
          } else {
            missing.push(`Location: prefers ${preferredLocs.slice(0, 2).join(' / ')}`);
          }
        } else {
          // No location preference stated — half credit.
          score += W_LOCATION * 0.5;
        }

        // ── 5. Role title (10 pts) ───────────────────────────────────────────
        if (preferredRoles.length > 0) {
          const jobTitleLower = job.title.toLowerCase();

          // Word-boundary match: "react" should not match "react native" as a full hit.
          const roleHit = preferredRoles.some((r) => {
            const roleLower = r.toLowerCase();
            // Exact containment in either direction on word tokens.
            const roleWords = roleLower.split(/\s+/);
            const titleWords = jobTitleLower.split(/\s+/);
            return (
              titleWords.some((tw) => roleWords.includes(tw)) ||
              roleWords.some((rw) => titleWords.includes(rw))
            );
          });

          if (roleHit) {
            score += W_ROLE;
            matched.push('✓ Preferred role match');
          }
        } else {
          // No role preference — half credit.
          score += W_ROLE * 0.5;
        }

        // ── 6. Notice period (5 pts) ─────────────────────────────────────────
        const jobNoticeMax = this.extractJobNoticeRequirement(job.description ?? '');
        if (noticeDays !== null && jobNoticeMax !== null) {
          if (noticeDays <= jobNoticeMax) {
            score += W_NOTICE;
            matched.push(`✓ Notice period OK (${profile.noticePeriod ?? 'immediate'})`);
          } else {
            missing.push(`Notice: role prefers ≤${jobNoticeMax} days`);
          }
        } else {
          score += W_NOTICE * 0.5;
        }

        return {
          job,
          score: Math.min(100, Math.round(score)),
          matchFactors: matched,
          missingSkills: missing,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Upserts all match results in a single transaction.
   * Previous implementation ran N individual upsert calls sequentially — with 200
   * Adzuna jobs per tenant that was 200 sequential DB round-trips per match run.
   * This version batches the work inside a $transaction for a single DB round-trip.
   */
  async persistMatches(
    userId: number,
    profileId: number,
    contactId: number,
    results: JobMatchResult[],
  ): Promise<void> {
    const top = results.slice(0, 100);
    if (top.length === 0) return;

    await this.prisma.$transaction(
      top.map((r) =>
        this.prisma.careerJobMatch.upsert({
          where: { profileId_jobId: { profileId, jobId: r.job.id } },
          create: {
            userId,
            profileId,
            contactId,
            jobId: r.job.id,
            score: r.score,
            matchFactors: r.matchFactors,
            missingSkills: r.missingSkills,
          },
          update: {
            score: r.score,
            matchFactors: r.matchFactors,
            missingSkills: r.missingSkills,
          },
        }),
      ),
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Reads the `years` or `duration` field that the AI extracts from each
   * experience entry. Falls back to 1 year per entry when the field is absent
   * or not parseable. Caps the total at 35 years.
   */
  private calcExperienceYears(experience: unknown): number {
    if (!Array.isArray(experience) || experience.length === 0) return 0;
    let total = 0;
    for (const entry of experience) {
      const raw = String((entry as any)?.years ?? (entry as any)?.duration ?? '');
      const n = parseFloat(raw.replace(/[^\d.]/g, ''));
      total += isNaN(n) ? 1 : Math.min(n, 20);
    }
    return Math.min(total > 0 ? total : experience.length, 35);
  }

  /**
   * Parses salary strings like "10 LPA", "10L", "10 lakh", "10-15 LPA" (takes lower
   * bound), "800000" (raw INR), into a LPA float.  Returns null when not parseable.
   */
  private parseSalaryLPA(raw: string | null | undefined): number | null {
    if (!raw) return null;
    const match = raw.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const n = parseFloat(match[1]);
    if (isNaN(n)) return null;
    // If the number is > 1000 it is likely raw rupees — convert to LPA.
    return n > 1000 ? Math.round(n / 100_000 * 10) / 10 : n;
  }

  /**
   * Converts a salary stored in the DB (could be raw INR or already LPA) to LPA.
   * Returns null when the input is null / 0.
   */
  private inrToLPA(inr: number | null | undefined): number | null {
    if (!inr) return null;
    return inr > 1000 ? Math.round(inr / 100_000 * 10) / 10 : inr;
  }

  private buildLocationPreferences(profile: CareerProfile): string[] {
    const fromPreferred = this.normalizeArray(profile.preferredLocations);
    const current = profile.currentLocation?.trim();
    const combined = current && !fromPreferred.includes(current)
      ? [...fromPreferred, current]
      : fromPreferred;
    return combined.map((l) => l.toLowerCase()).filter(Boolean);
  }

  private locationMatches(preferred: string, jobCity: string): boolean {
    if (!preferred || !jobCity) return false;
    if (jobCity.includes(preferred) || preferred.includes(jobCity.split(',')[0]?.trim() ?? '')) {
      return true;
    }
    const aliases = CITY_ALIASES[preferred.split(/\s+/)[0]] ?? [preferred];
    return aliases.some(
      (alias) => jobCity.includes(alias) || alias.includes(jobCity.split(',')[0]?.trim() ?? ''),
    );
  }

  private skillMatches(profileSkills: string[], skill: string): boolean {
    return profileSkills.some((ps) => {
      if (ps === skill) return true;
      const [short, long] = ps.length <= skill.length ? [ps, skill] : [skill, ps];
      if (short.length < 2) return false;
      return new RegExp(`\\b${this.escapeRegex(short)}\\b`).test(long);
    });
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getJobWorkMode(job: CareerJob): string {
    const tags = job.tags as { workMode?: string } | null;
    if (tags?.workMode && tags.workMode !== 'unknown') {
      return tags.workMode;
    }
    const city = (job.city ?? job.location ?? '').toLowerCase();
    if (city.includes('remote')) return 'remote';
    return 'unknown';
  }

  private normalizeSkills(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw
      .map((s) => normalizeSkillToken(String(s)))
      .filter(Boolean);
  }

  private normalizeArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

  private cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Parses "30 days", "2 months", "Immediate" into approximate days. */
  private parseNoticePeriodDays(raw: string | null | undefined): number | null {
    if (!raw?.trim()) return null;
    const t = raw.toLowerCase();
    if (/immediate|no\s*notice|zero|0\s*day|serving|n\/a|none/i.test(t)) {
      return 0;
    }
    const months = t.match(/(\d+(?:\.\d+)?)\s*months?/);
    if (months) {
      return Math.round(parseFloat(months[1]) * 30);
    }
    const days = t.match(/(\d+)\s*days?/);
    if (days) {
      return parseInt(days[1], 10);
    }
    const num = t.match(/(\d+)/);
    if (num) {
      return parseInt(num[1], 10);
    }
    return null;
  }

  /** Reads notice urgency from job description when present. */
  private extractJobNoticeRequirement(description: string): number | null {
    const d = description.toLowerCase();
    if (/immediate joiner|join immediately|immediate joining|no notice period|can join immediately/i.test(d)) {
      return 0;
    }
    const maxNotice = d.match(/(?:max|maximum|upto|up to|within)\s*(\d+)\s*days?\s*(?:notice|np)/i);
    if (maxNotice) {
      return parseInt(maxNotice[1], 10);
    }
    const noticeUpTo = d.match(/(\d+)\s*days?\s*notice/i);
    if (noticeUpTo) {
      return parseInt(noticeUpTo[1], 10);
    }
    return null;
  }
}
