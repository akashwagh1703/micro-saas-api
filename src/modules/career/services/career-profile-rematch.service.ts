import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerProfile } from '@prisma/client';
import {
  CAREER_MATCH_TIER_STRONG,
  CareerMatchingService,
  MatchPipelineResult,
} from './career-matching.service';
import { profileMatchFieldsChanged } from '../career-profile-match.util';

export interface RematchSummary {
  matchCount: number;
  strongMatchCount: number;
  totalScored: number;
  topScore: number;
  autoTriggered: boolean;
}

@Injectable()
export class CareerProfileRematchService {
  constructor(
    private readonly config: ConfigService,
    private readonly matching: CareerMatchingService,
  ) {}

  autoRematchEnabled(): boolean {
    return this.config.get<string>('CAREER_AUTO_REMATCH_ON_PROFILE_UPDATE', 'true') !== 'false';
  }

  shouldAutoRematch(before: CareerProfile, after: CareerProfile): boolean {
    return after.isComplete && profileMatchFieldsChanged(before, after);
  }

  summarize(result: MatchPipelineResult): RematchSummary {
    const strong = result.allMatches.filter((m) => m.score >= CAREER_MATCH_TIER_STRONG);
    return {
      matchCount: result.shownMatches.length,
      strongMatchCount: strong.length,
      totalScored: result.allMatches.length,
      topScore: result.shownMatches[0]?.score ?? 0,
      autoTriggered: false,
    };
  }

  async rematchProfile(userId: number, profile: CareerProfile): Promise<RematchSummary> {
    const result = await this.matching.matchAndPersistForProfile(userId, profile, {
      tier: 'good',
    });
    return this.summarize(result);
  }

  async rematchIfProfileChanged(
    userId: number,
    before: CareerProfile,
    after: CareerProfile,
  ): Promise<RematchSummary | null> {
    if (!this.autoRematchEnabled() || !this.shouldAutoRematch(before, after)) {
      return null;
    }

    const summary = await this.rematchProfile(userId, after);
    return { ...summary, autoTriggered: true };
  }
}
