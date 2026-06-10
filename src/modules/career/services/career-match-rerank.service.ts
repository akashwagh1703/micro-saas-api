import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerAiService } from './career-ai.service';
import { CareerProfileService } from './career-profile.service';
import {
  MatchFactorBreakdown,
  JobMatchResult,
  overallBand,
  readMatchBreakdown,
} from './career-match-scoring.util';

const RULE_WEIGHT = 0.6;
const AI_WEIGHT = 0.4;

export interface AiRerankOptions {
  topN?: number;
  force?: boolean;
}

@Injectable()
export class CareerMatchRerankService {
  private readonly logger = new Logger(CareerMatchRerankService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly careerAi: CareerAiService,
    private readonly profiles: CareerProfileService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('CAREER_MATCH_AI_RERANK_ENABLED', 'true') !== 'false';
  }

  defaultTopN(): number {
    const n = parseInt(this.config.get<string>('CAREER_MATCH_AI_RERANK_TOP_N') ?? '30', 10);
    return Number.isNaN(n) ? 30 : Math.min(50, Math.max(5, n));
  }

  /**
   * Blends rule scores with AI rerank on the top N candidates.
   * final = 0.6 × rule + 0.4 × ai (cached per profile + job when unchanged).
   */
  async applyAiRerank(
    userId: number,
    profile: CareerProfile,
    matches: JobMatchResult[],
    options: AiRerankOptions = {},
  ): Promise<JobMatchResult[]> {
    if (!this.isEnabled() || matches.length === 0) {
      return matches;
    }

    const topN = options.topN ?? this.defaultTopN();
    const profileKey = this.profileCacheKey(profile);
    const sorted = [...matches].sort((a, b) => b.score - a.score);
    const candidates = sorted.slice(0, topN);

    for (const match of sorted) {
      match.breakdown.rule_score = match.score;
    }

    const jobIds = candidates.map((c) => c.job.id);
    const cachedRows =
      !options.force && jobIds.length > 0
        ? await this.prisma.careerJobMatch.findMany({
            where: { profileId: profile.id, jobId: { in: jobIds } },
            select: { jobId: true, matchFactors: true },
          })
        : [];

    const cachedByJob = new Map(
      cachedRows.map((row) => [row.jobId, readMatchBreakdown(row.matchFactors)]),
    );

    const needsAi: JobMatchResult[] = [];
    const aiByJobId = new Map<number, { aiScore: number; reason: string }>();

    for (const match of candidates) {
      const cached = cachedByJob.get(match.job.id);
      const cachedAi = cached?.ai;
      if (
        cachedAi &&
        cachedAi.profile_key === profileKey &&
        cachedAi.rule_score === match.score &&
        cachedAi.reason
      ) {
        aiByJobId.set(match.job.id, { aiScore: cachedAi.score, reason: cachedAi.reason });
        continue;
      }
      needsAi.push(match);
    }

    if (needsAi.length > 0) {
      const snapshot = this.profiles.profileSnapshot(profile);
      const aiInput = needsAi.map((m) => ({
        id: m.job.id,
        title: m.job.title,
        company: m.job.company,
        ruleScore: m.score,
        summary: this.jobSummary(m.job),
      }));

      const aiResults = await this.careerAi.rerankJobMatches(userId, snapshot, aiInput);
      if (aiResults) {
        for (const [jobId, result] of aiResults.entries()) {
          aiByJobId.set(jobId, result);
        }
      } else {
        this.logger.debug(`AI rerank skipped userId=${userId} profileId=${profile.id} (no AI result)`);
      }
    }

    const blended = sorted.map((match) => {
      const ai = aiByJobId.get(match.job.id);
      if (!ai) {
        return match;
      }

      const ruleScore = match.breakdown.rule_score ?? match.score;
      const finalScore = Math.min(
        100,
        Math.round(RULE_WEIGHT * ruleScore + AI_WEIGHT * ai.aiScore),
      );

      const display = [...match.matchFactors];
      if (ai.reason && !display.some((line) => line.includes(ai.reason.slice(0, 20)))) {
        display.unshift(`🤖 ${ai.reason}`);
      }

      const breakdown: MatchFactorBreakdown = {
        ...match.breakdown,
        rule_score: ruleScore,
        ai: {
          score: ai.aiScore,
          rule_score: ruleScore,
          reason: ai.reason,
          profile_key: profileKey,
          max: 100,
        },
        overall_band: overallBand(finalScore),
      };

      return {
        ...match,
        score: finalScore,
        matchFactors: display,
        breakdown,
      };
    });

    return blended.sort((a, b) => b.score - a.score);
  }

  private profileCacheKey(profile: CareerProfile): string {
    return profile.updatedAt?.toISOString() ?? `profile-${profile.id}`;
  }

  private jobSummary(job: CareerJob): string {
    const skills = Array.isArray(job.requiredSkills)
      ? (job.requiredSkills as string[]).slice(0, 8).join(', ')
      : '';
    const desc = (job.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 350);
    return [
      `Location: ${job.location ?? job.city ?? '—'}`,
      `Salary: ${job.salaryText ?? '—'}`,
      skills ? `Skills: ${skills}` : '',
      desc ? `About: ${desc}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }
}
