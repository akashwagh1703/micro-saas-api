import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CAREER_MATCH_TIER_GOOD,
  CAREER_MATCH_TIER_STRONG,
} from './career-matching.service';

export interface ZeroMatchProfileSummary {
  id: number;
  full_name: string | null;
  phone: string | null;
}

@Injectable()
export class CareerMatchAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOperatorMetrics(userId: number) {
    const [
      profiles,
      resumes,
      jobs,
      matches,
      applications,
      notifications,
      completeProfiles,
      matchAgg,
      strongMatches,
      goodMatches,
      byStatus,
      feedbackGroups,
      completeProfileRows,
      profilesWithGoodMatch,
    ] = await Promise.all([
      this.prisma.careerProfile.count({ where: { userId } }),
      this.prisma.careerResume.count({ where: { userId } }),
      this.prisma.careerJob.count({ where: { userId, isActive: true } }),
      this.prisma.careerJobMatch.count({ where: { userId } }),
      this.prisma.careerApplication.count({ where: { userId } }),
      this.prisma.careerNotification.count({ where: { userId } }),
      this.prisma.careerProfile.count({ where: { userId, isComplete: true } }),
      this.prisma.careerJobMatch.aggregate({
        where: { userId },
        _avg: { score: true },
        _count: true,
      }),
      this.prisma.careerJobMatch.count({
        where: { userId, score: { gte: CAREER_MATCH_TIER_STRONG } },
      }),
      this.prisma.careerJobMatch.count({
        where: { userId, score: { gte: CAREER_MATCH_TIER_GOOD } },
      }),
      this.prisma.careerApplication.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),
      this.prisma.careerMatchFeedback.groupBy({
        by: ['event'],
        where: { userId },
        _count: true,
      }),
      this.prisma.careerProfile.findMany({
        where: { userId, isComplete: true },
        select: {
          id: true,
          fullName: true,
          phone: true,
          contact: { select: { phone: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.careerJobMatch.groupBy({
        by: ['profileId'],
        where: { userId, score: { gte: CAREER_MATCH_TIER_GOOD } },
      }),
    ]);

    const goodMatchProfileIds = new Set(profilesWithGoodMatch.map((row) => row.profileId));
    const zeroMatchProfiles: ZeroMatchProfileSummary[] = completeProfileRows
      .filter((p) => !goodMatchProfileIds.has(p.id))
      .map((p) => ({
        id: p.id,
        full_name: p.fullName,
        phone: p.phone ?? p.contact?.phone ?? null,
      }));

    const profilesWithMatches = goodMatchProfileIds.size;
    const applyRate =
      profilesWithMatches > 0
        ? Math.round((applications / profilesWithMatches) * 100) / 100
        : 0;

    const feedbackByEvent = Object.fromEntries(
      feedbackGroups.map((row) => [row.event, row._count]),
    );

    return {
      profiles,
      complete_profiles: completeProfiles,
      resumes,
      jobs,
      matches,
      applications,
      notifications,
      applications_by_status: byStatus,
      match_quality: {
        avg_score: Math.round((matchAgg._avg.score ?? 0) * 10) / 10,
        total_scored_pairs: matchAgg._count,
        strong_matches: strongMatches,
        good_matches: goodMatches,
        profiles_with_good_matches: profilesWithMatches,
        zero_match_profiles: zeroMatchProfiles.length,
        apply_rate: applyRate,
        feedback_by_event: feedbackByEvent,
      },
      zero_match_profiles: zeroMatchProfiles.slice(0, 25),
    };
  }
}
