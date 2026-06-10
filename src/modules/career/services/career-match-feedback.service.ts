import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerJob, CareerProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  accumulateBoostMaps,
  learningPatchForCoverLetter,
  learningPatchForDismiss,
  learningPatchForPositiveSignal,
  MATCH_LEARNING_KEY,
  MatchFeedbackEvent,
  mergeMatchLearningPrefs,
  normalizeCompanyKey,
  readMatchLearningPrefs,
} from '../career-match-learning.util';

@Injectable()
export class CareerMatchFeedbackService {
  private readonly logger = new Logger(CareerMatchFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('CAREER_MATCH_LEARNING_ENABLED', 'true') !== 'false';
  }

  async recordEvent(
    userId: number,
    profile: CareerProfile,
    job: CareerJob,
    event: MatchFeedbackEvent,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await this.prisma.careerMatchFeedback.create({
        data: {
          userId,
          profileId: profile.id,
          jobId: job.id,
          event,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
        },
      });

      if (event === 'viewed') {
        return;
      }

      await this.updateLearningPrefs(profile, job, event);
    } catch (err) {
      this.logger.warn(
        `Match feedback failed profileId=${profile.id} jobId=${job.id} event=${event}: ${String(err)}`,
      );
    }
  }

  private async updateLearningPrefs(
    profile: CareerProfile,
    job: CareerJob,
    event: MatchFeedbackEvent,
  ): Promise<void> {
    const current = readMatchLearningPrefs(profile.onboardingData);
    let patch;

    if (event === 'applied') {
      patch = learningPatchForPositiveSignal(job);
    } else if (event === 'cover_letter_generated') {
      patch = learningPatchForCoverLetter(job);
    } else if (event === 'dismissed') {
      const company = normalizeCompanyKey(job.company);
      const priorCompanyDismissals = company
        ? await this.prisma.careerMatchFeedback.count({
            where: {
              profileId: profile.id,
              event: 'dismissed',
              job: { company: { equals: job.company, mode: 'insensitive' } },
            },
          })
        : 0;
      patch = learningPatchForDismiss(job, priorCompanyDismissals);
    } else {
      return;
    }

    const merged = mergeMatchLearningPrefs(profile.onboardingData, {
      companyBoost: accumulateBoostMaps(current.companyBoost, patch.companyBoost ?? {}, 10),
      titleBoost: accumulateBoostMaps(current.titleBoost, patch.titleBoost ?? {}, 8),
      skillBoost: accumulateBoostMaps(current.skillBoost, patch.skillBoost ?? {}, 8),
      blockedCompanies: [
        ...new Set([...current.blockedCompanies, ...(patch.blockedCompanies ?? [])]),
      ].slice(0, 30),
      blockedTitleTokens: [
        ...new Set([...current.blockedTitleTokens, ...(patch.blockedTitleTokens ?? [])]),
      ].slice(0, 40),
      eventCounts: {
        applied: current.eventCounts.applied + (patch.eventCounts?.applied ?? 0),
        dismissed: current.eventCounts.dismissed + (patch.eventCounts?.dismissed ?? 0),
        cover_letter: current.eventCounts.cover_letter + (patch.eventCounts?.cover_letter ?? 0),
      },
    });

    const data = (profile.onboardingData as Record<string, unknown>) ?? {};
    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: {
        onboardingData: {
          ...data,
          [MATCH_LEARNING_KEY]: merged,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
