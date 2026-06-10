import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeSkillToken } from '../job-sources/job-source.utils';
import { CareerJobService } from './career-job.service';
import {
  buildStoredMatchFactors,
  formatSkillDisplayLines,
  inrToLPA,
  JobMatchResult,
  MatchFactorBreakdown,
  overallBand,
  parseSalaryLPA,
  readMatchFactorLines,
  scoreExperienceAndSeniority,
  scoreLocation,
  scoreRoleTitle,
  scoreSalary,
  scoreSkills,
} from './career-match-scoring.util';
import { CareerMatchRerankService } from './career-match-rerank.service';

export type { JobMatchResult } from './career-match-scoring.util';

export type MatchTier = 'strong' | 'good' | 'stretch';

export { readMatchFactorLines } from './career-match-scoring.util';

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
  keyword?: string;
  tier?: MatchTier;
  /** Pre-filtered job list (e.g. instant alerts on new listings only). */
  jobList?: CareerJob[];
  /** Set false to skip AI rerank even when enabled globally. */
  aiRerank?: boolean;
}

export interface MatchPipelineResult {
  allMatches: JobMatchResult[];
  shownMatches: JobMatchResult[];
}

const W_SKILLS = 40;
const W_EXPERIENCE = 14;
const W_SENIORITY = 6;
const W_SALARY = 15;
const W_LOCATION = 15;
const W_ROLE = 5;
const W_NOTICE = 5;

export const CAREER_MIN_MATCH_SCORE = CAREER_MATCH_TIER_GOOD;

export function formatMatchScoreLabel(score: number): string {
  if (score >= 95) return 'Excellent Match';
  if (score >= CAREER_MATCH_TIER_STRONG) return 'Strong Match';
  if (score >= CAREER_MATCH_TIER_GOOD) return 'Good Match';
  if (score >= CAREER_MATCH_TIER_STRETCH) return 'Partial Match';
  return 'Low Match';
}

@Injectable()
export class CareerMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: CareerJobService,
    private readonly rerank: CareerMatchRerankService,
  ) {}

  filterMatchesByTier(results: JobMatchResult[], tier: MatchTier = 'good'): JobMatchResult[] {
    const min = minScoreForTier(tier);
    return results.filter((r) => r.score >= min);
  }

  filterQualityMatches(results: JobMatchResult[]): JobMatchResult[] {
    return this.filterMatchesByTier(results, 'good');
  }

  async matchAndPersistForProfile(
    userId: number,
    profile: CareerProfile,
    options: MatchPipelineOptions = {},
  ): Promise<MatchPipelineResult> {
    const tier = options.tier ?? 'good';
    let jobList = options.jobList ?? (await this.jobs.listActive(userId));

    const keyword = options.keyword?.trim();
    if (!options.jobList) {
      if (keyword && keyword.length > 1 && keyword.toLowerCase() !== 'all') {
        jobList = this.jobs.searchByKeyword(jobList, keyword);
      } else {
        jobList = this.jobs.relevantJobsForProfile(jobList, profile);
      }
    }

    const ruleMatches = this.matchProfileToJobs(profile, jobList);
    const allMatches =
      options.aiRerank !== false && this.rerank.isEnabled()
        ? await this.rerank.applyAiRerank(userId, profile, ruleMatches)
        : ruleMatches;
    await this.persistMatches(userId, profile.id, profile.contactId, allMatches);
    const shownMatches = this.filterMatchesByTier(allMatches, tier);

    return { allMatches, shownMatches };
  }

  matchProfileToJobs(profile: CareerProfile, jobs: CareerJob[]): JobMatchResult[] {
    const profileSkills = this.normalizeSkills(profile.skills);
    const preferredRoles = this.normalizeArray(profile.preferredRoles);
    const preferredLocs = this.buildLocationPreferences(profile);
    const profileExpYears = this.calcExperienceYears(profile.experience);
    const expectedSalaryL = parseSalaryLPA(profile.expectedSalary);
    const workPref = (profile.workPreference ?? '').toLowerCase();
    const noticeDays = this.parseNoticePeriodDays(profile.noticePeriod);

    return jobs
      .map((job) => {
        const required = this.normalizeSkills(job.requiredSkills);
        const skillScore = scoreSkills(
          profileSkills,
          required,
          job.description ?? '',
          W_SKILLS,
        );
        const { display: skillLines, missingDisplay } = formatSkillDisplayLines(
          skillScore.matched,
          skillScore.partial,
          skillScore.missing,
        );

        const expSeniority = scoreExperienceAndSeniority(
          profileExpYears,
          job,
          W_EXPERIENCE,
          W_SENIORITY,
        );

        const salary = scoreSalary(
          expectedSalaryL,
          inrToLPA(job.salaryMin),
          inrToLPA(job.salaryMax),
          W_SALARY,
        );

        const location = scoreLocation(preferredLocs, workPref, job, W_LOCATION);
        const role = scoreRoleTitle(preferredRoles, job.title, W_ROLE);
        const notice = this.scoreNotice(noticeDays, job.description ?? '', profile.noticePeriod, W_NOTICE);

        const rawScore =
          skillScore.points +
          expSeniority.experiencePoints +
          expSeniority.seniorityPoints +
          salary.points +
          location.points +
          role.points +
          notice.points;

        const score = Math.min(100, Math.round(rawScore));
        const band = overallBand(score);

        const display: string[] = [
          ...skillLines,
          `✓ Experience: ${expSeniority.experienceNote}`,
          `✓ Seniority: ${expSeniority.seniorityNote}`,
        ];
        if (salary.points >= W_SALARY * 0.7) {
          display.push(`✓ Salary: ${salary.note ?? 'aligned'}`);
        }
        if (location.points >= W_LOCATION * 0.6) {
          display.push(`✓ ${location.note ?? 'Location fit'}`);
        }
        if (role.points >= W_ROLE * 0.5) {
          display.push(`✓ ${role.note ?? 'Role fit'}`);
        }
        if (notice.points >= W_NOTICE * 0.8) {
          display.push(`✓ ${notice.note ?? 'Notice period OK'}`);
        }

        const missingSkills: string[] = [...missingDisplay];
        if (expSeniority.experiencePoints < W_EXPERIENCE * 0.5) {
          missingSkills.push('Experience gap');
        }
        if (expSeniority.seniorityPoints < W_SENIORITY * 0.5) {
          missingSkills.push(`Seniority: ${expSeniority.seniorityNote}`);
        }
        if (salary.points < W_SALARY * 0.5 && salary.note) {
          missingSkills.push(salary.note);
        }
        if (location.points < W_LOCATION * 0.4 && location.note) {
          missingSkills.push(location.note);
        }
        if (role.points < W_ROLE * 0.4 && role.note) {
          missingSkills.push(role.note);
        }
        if (notice.points < W_NOTICE * 0.5 && notice.note) {
          missingSkills.push(notice.note);
        }

        const breakdown: MatchFactorBreakdown = {
          rule_score: score,
          skills: {
            matched: skillScore.matched,
            partial: skillScore.partial,
            missing: skillScore.missing,
            score: Math.round(skillScore.points),
            max: W_SKILLS,
          },
          experience: {
            profileYears: profileExpYears,
            required: expSeniority.experienceNote,
            score: Math.round(expSeniority.experiencePoints),
            max: W_EXPERIENCE,
          },
          seniority: {
            profile: expSeniority.profileLevel,
            job: expSeniority.jobLevel,
            score: Math.round(expSeniority.seniorityPoints),
            max: W_SENIORITY,
          },
          salary: {
            score: Math.round(salary.points),
            max: W_SALARY,
            note: salary.note,
          },
          location: {
            score: Math.round(location.points),
            max: W_LOCATION,
            note: location.note,
          },
          role: {
            score: Math.round(role.points),
            max: W_ROLE,
            note: role.note,
          },
          notice: {
            score: Math.round(notice.points),
            max: W_NOTICE,
            note: notice.note,
          },
          overall_band: band,
        };

        return {
          job,
          score,
          matchFactors: display,
          missingSkills,
          breakdown,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  async persistMatches(
    userId: number,
    profileId: number,
    contactId: number,
    results: JobMatchResult[],
  ): Promise<void> {
    const top = results.slice(0, 100);
    if (top.length === 0) return;

    await this.prisma.$transaction(
      top.map((r) => {
        const stored = buildStoredMatchFactors(r.matchFactors, r.breakdown);
        return this.prisma.careerJobMatch.upsert({
          where: { profileId_jobId: { profileId, jobId: r.job.id } },
          create: {
            userId,
            profileId,
            contactId,
            jobId: r.job.id,
            score: r.score,
            matchFactors: stored as unknown as Prisma.InputJsonValue,
            missingSkills: r.missingSkills,
          },
          update: {
            score: r.score,
            matchFactors: stored as unknown as Prisma.InputJsonValue,
            missingSkills: r.missingSkills,
          },
        });
      }),
    );
  }

  private scoreNotice(
    noticeDays: number | null,
    description: string,
    noticeLabel: string | null | undefined,
    maxPoints: number,
  ): { points: number; note?: string } {
    const jobNoticeMax = this.extractJobNoticeRequirement(description);
    if (noticeDays !== null && jobNoticeMax !== null) {
      if (noticeDays <= jobNoticeMax) {
        return { points: maxPoints, note: `Notice OK (${noticeLabel ?? 'immediate'})` };
      }
      return { points: 0, note: `Notice: role prefers ≤${jobNoticeMax} days` };
    }
    return { points: maxPoints * 0.5, note: 'Notice not specified' };
  }

  private calcExperienceYears(experience: unknown): number {
    if (!Array.isArray(experience) || experience.length === 0) return 0;
    let total = 0;
    for (const entry of experience) {
      const raw = String((entry as { years?: string; duration?: string })?.years ?? (entry as { duration?: string })?.duration ?? '');
      const n = parseFloat(raw.replace(/[^\d.]/g, ''));
      total += Number.isNaN(n) ? 1 : Math.min(n, 20);
    }
    return Math.min(total > 0 ? total : experience.length, 35);
  }

  private buildLocationPreferences(profile: CareerProfile): string[] {
    const fromPreferred = this.normalizeArray(profile.preferredLocations);
    const current = profile.currentLocation?.trim();
    const combined =
      current && !fromPreferred.includes(current) ? [...fromPreferred, current] : fromPreferred;
    return combined.map((l) => l.toLowerCase()).filter(Boolean);
  }

  private normalizeSkills(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map((s) => normalizeSkillToken(String(s))).filter(Boolean);
  }

  private normalizeArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

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
