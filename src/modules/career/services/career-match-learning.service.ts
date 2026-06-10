import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerProfile } from '@prisma/client';
import {
  computeLearningAdjustment,
  readMatchLearningPrefs,
} from '../career-match-learning.util';
import {
  JobMatchResult,
  MatchFactorBreakdown,
  overallBand,
} from './career-match-scoring.util';

@Injectable()
export class CareerMatchLearningService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<string>('CAREER_MATCH_LEARNING_ENABLED', 'true') !== 'false';
  }

  maxAdjustment(): number {
    const n = parseInt(this.config.get<string>('CAREER_MATCH_LEARNING_MAX_ADJUST') ?? '15', 10);
    return Number.isNaN(n) ? 15 : Math.min(25, Math.max(5, n));
  }

  applyLearningAdjustments(profile: CareerProfile, matches: JobMatchResult[]): JobMatchResult[] {
    if (!this.isEnabled() || matches.length === 0) {
      return matches;
    }

    const prefs = readMatchLearningPrefs(profile.onboardingData);
    const maxAdjust = this.maxAdjustment();
    const hasSignals =
      Object.keys(prefs.companyBoost).length > 0 ||
      Object.keys(prefs.titleBoost).length > 0 ||
      Object.keys(prefs.skillBoost).length > 0 ||
      prefs.blockedCompanies.length > 0 ||
      prefs.blockedTitleTokens.length > 0;

    if (!hasSignals) {
      return matches;
    }

    const adjusted = matches.map((match) => {
      const { adjustment, reasons } = computeLearningAdjustment(match.job, prefs, maxAdjust);
      if (adjustment === 0) {
        return match;
      }

      const finalScore = Math.min(100, Math.max(0, match.score + adjustment));
      const display = [...match.matchFactors];
      if (reasons.length > 0 && !display.some((line) => line.startsWith('📈'))) {
        display.unshift(`📈 ${reasons[0]}`);
      }

      const breakdown: MatchFactorBreakdown = {
        ...match.breakdown,
        feedback: {
          adjustment,
          reasons,
          max: maxAdjust,
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

    return adjusted.sort((a, b) => b.score - a.score);
  }
}
