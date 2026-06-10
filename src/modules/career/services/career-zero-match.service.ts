import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerProfileKeywordsService } from './career-profile-keywords.service';
import { CareerJobFetcherService } from './career-job-fetcher.service';
import {
  CAREER_MATCH_TIER_GOOD,
  CAREER_MATCH_TIER_STRONG,
  CareerMatchingService,
} from './career-matching.service';

export interface ZeroMatchSuggestion {
  code: string;
  message: string;
  action?: string;
}

export interface ZeroMatchAnalysis {
  zero_good_matches: boolean;
  zero_strong_matches: boolean;
  good_match_count: number;
  strong_match_count: number;
  total_scored: number;
  top_score: number;
  active_jobs: number;
  suggestions: ZeroMatchSuggestion[];
  fetch_keywords: string[];
}

export interface ZeroMatchPlaybookResult extends ZeroMatchAnalysis {
  jobs_fetched: number;
  fetch_by_source?: Record<string, number>;
  rematch?: {
    good_match_count: number;
    strong_match_count: number;
    top_score: number;
  };
}

function asArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

@Injectable()
export class CareerZeroMatchService {
  private readonly logger = new Logger(CareerZeroMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly keywords: CareerProfileKeywordsService,
    private readonly fetcher: CareerJobFetcherService,
    private readonly matching: CareerMatchingService,
  ) {}

  analyze(
    profile: CareerProfile,
    stats: {
      goodMatchCount: number;
      strongMatchCount: number;
      totalScored: number;
      topScore: number;
      activeJobs: number;
    },
  ): ZeroMatchAnalysis {
    const suggestions: ZeroMatchSuggestion[] = [];
    const skills = asArray(profile.skills);
    const roles = asArray(profile.preferredRoles);
    const locations = asArray(profile.preferredLocations);
    const fetch_keywords = this.keywords.buildFetchKeywordsForProfile(profile, 5);

    if (skills.length === 0) {
      suggestions.push({
        code: 'missing_skills',
        message: 'Add technical skills to the profile (or re-upload a resume with a skills section).',
        action: 'UPLOAD RESUME',
      });
    }

    if (roles.length === 0) {
      suggestions.push({
        code: 'missing_roles',
        message: 'Set preferred job titles (e.g. React Developer, Data Analyst).',
        action: 'Update preferred roles',
      });
    }

    if (!profile.currentLocation?.trim() && locations.length === 0) {
      suggestions.push({
        code: 'missing_location',
        message: 'Add current city or preferred work locations (include Remote if applicable).',
        action: 'Update location',
      });
    }

    if (stats.activeJobs === 0) {
      suggestions.push({
        code: 'no_jobs',
        message: 'No active jobs in the pool — operator should fetch listings for this seeker.',
        action: 'Fetch jobs in portal',
      });
    } else if (stats.goodMatchCount === 0 && stats.totalScored > 0) {
      suggestions.push({
        code: 'low_scores',
        message:
          'Jobs exist but none score 65%+ — broaden preferred roles, add related skills, or adjust salary/location expectations.',
        action: 'Broaden profile',
      });
    }

    if (stats.strongMatchCount === 0 && stats.goodMatchCount > 0) {
      suggestions.push({
        code: 'no_strong',
        message:
          'Good matches exist but none reach 80%+ for digest/alerts — refine skills or fetch more targeted listings.',
        action: 'Run targeted fetch',
      });
    }

    if (fetch_keywords.length > 0 && stats.activeJobs < 20) {
      suggestions.push({
        code: 'targeted_fetch',
        message: `Fetch jobs for: ${fetch_keywords.slice(0, 3).join(', ')}`,
        action: 'Run zero-match playbook',
      });
    }

    return {
      zero_good_matches: stats.goodMatchCount === 0,
      zero_strong_matches: stats.strongMatchCount === 0,
      good_match_count: stats.goodMatchCount,
      strong_match_count: stats.strongMatchCount,
      total_scored: stats.totalScored,
      top_score: stats.topScore,
      active_jobs: stats.activeJobs,
      suggestions,
      fetch_keywords,
    };
  }

  formatWhatsAppSuggestions(analysis: ZeroMatchAnalysis): string {
    if (analysis.suggestions.length === 0) {
      return 'Try *FIND JOBS {skill}* or ask your operator to fetch more listings.';
    }
    return analysis.suggestions
      .slice(0, 4)
      .map((s) => `• ${s.message}`)
      .join('\n');
  }

  async runPlaybook(
    userId: number,
    profileId: number,
    options: { fetch?: boolean; rematch?: boolean; location?: string } = {},
  ): Promise<ZeroMatchPlaybookResult | null> {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      return null;
    }

    const activeJobs = await this.prisma.careerJob.count({
      where: { userId, isActive: true },
    });

    const { allMatches, shownMatches } = await this.matching.matchAndPersistForProfile(
      userId,
      profile,
      { tier: 'good' },
    );

    const strongMatches = allMatches.filter((m) => m.score >= CAREER_MATCH_TIER_STRONG);
    const analysis = this.analyze(profile, {
      goodMatchCount: shownMatches.length,
      strongMatchCount: strongMatches.length,
      totalScored: allMatches.length,
      topScore: shownMatches[0]?.score ?? allMatches[0]?.score ?? 0,
      activeJobs,
    });

    let jobsFetched = 0;
    let fetchBySource: Record<string, number> | undefined;

    const shouldFetch =
      options.fetch !== false &&
      this.config.get<string>('CAREER_ZERO_MATCH_AUTO_FETCH', 'true') !== 'false' &&
      analysis.fetch_keywords.length > 0 &&
      (analysis.zero_good_matches || activeJobs < 30);

    if (shouldFetch && (await this.fetcher.isEnabled(userId))) {
      const location = options.location?.trim() || 'india';
      for (const keyword of analysis.fetch_keywords.slice(0, 3)) {
        try {
          const result = await this.fetcher.fetchAndStoreDetailed(userId, keyword, location, 1);
          jobsFetched += result.total;
          fetchBySource = { ...(fetchBySource ?? {}), ...result.bySource };
        } catch (err) {
          this.logger.warn(`Zero-match fetch failed keyword="${keyword}": ${String(err)}`);
        }
      }
    }

    let rematchSummary: ZeroMatchPlaybookResult['rematch'];
    if (options.rematch !== false && (jobsFetched > 0 || analysis.zero_good_matches)) {
      const rematch = await this.matching.matchAndPersistForProfile(userId, profile, {
        tier: 'good',
      });
      const strong = rematch.allMatches.filter((m) => m.score >= CAREER_MATCH_TIER_STRONG);
      rematchSummary = {
        good_match_count: rematch.shownMatches.length,
        strong_match_count: strong.length,
        top_score: rematch.shownMatches[0]?.score ?? 0,
      };
    }

    return {
      ...analysis,
      good_match_count: rematchSummary?.good_match_count ?? analysis.good_match_count,
      strong_match_count: rematchSummary?.strong_match_count ?? analysis.strong_match_count,
      top_score: rematchSummary?.top_score ?? analysis.top_score,
      zero_good_matches: (rematchSummary?.good_match_count ?? analysis.good_match_count) === 0,
      zero_strong_matches: (rematchSummary?.strong_match_count ?? analysis.strong_match_count) === 0,
      jobs_fetched: jobsFetched,
      fetch_by_source: fetchBySource,
      rematch: rematchSummary,
    };
  }
}
