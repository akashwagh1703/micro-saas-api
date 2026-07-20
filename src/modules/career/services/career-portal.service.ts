import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { readAlertPreferences } from '../career-alert-preferences.util';
import { readGuidanceHistory } from '../career-guidance-state.util';
import { readInterviewHistory } from '../career-interview-state.util';
import { readMatchBreakdown, readMatchFactorLines } from './career-match-scoring.util';
import { CareerPortalShareService } from './career-portal-share.service';
import { CareerSeekerBillingService } from './career-seeker-billing.service';

@Injectable()
export class CareerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalShare: CareerPortalShareService,
    private readonly seekerBilling: CareerSeekerBillingService,
  ) {}

  async getPortalData(token: string) {
    const payload = this.portalShare.verifyToken(token.trim());
    if (!payload) {
      throw new NotFoundException('Invalid or expired portal link');
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: payload.profileId, userId: payload.userId },
      include: {
        contact: { select: { phone: true, name: true } },
        jobMatches: {
          include: { job: true },
          orderBy: { score: 'desc' },
          take: 15,
        },
        applications: {
          include: { job: true },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const notifications = await this.prisma.careerNotification.findMany({
      where: { profileId: profile.id, userId: profile.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return {
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        email: profile.email,
        phone: profile.phone ?? profile.contact?.phone,
        skills: profile.skills,
        preferred_roles: profile.preferredRoles,
        preferred_locations: profile.preferredLocations,
        current_location: profile.currentLocation,
        work_preference: profile.workPreference,
        is_complete: profile.isComplete,
      },
      matches: profile.jobMatches.map((m) => ({
        id: m.id,
        job_id: m.jobId,
        score: m.score,
        missing_skills: m.missingSkills,
        match_highlights: readMatchFactorLines(m.matchFactors),
        breakdown: readMatchBreakdown(m.matchFactors),
        feedback_actions: ['dismissed', 'viewed'],
        job: m.job
          ? {
              id: m.job.id,
              title: m.job.title,
              company: m.job.company,
              location: m.job.location,
              salary_text: m.job.salaryText,
              job_type: m.job.jobType,
            }
          : null,
      })),
      applications: profile.applications.map((a) => ({
        id: a.id,
        status: a.status,
        updated_at: a.updatedAt,
        job: a.job
          ? {
              title: a.job.title,
              company: a.job.company,
              location: a.job.location,
            }
          : null,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        status: n.status,
        sent_at: n.sentAt,
        created_at: n.createdAt,
        payload: n.payload,
      })),
      alert_preferences: readAlertPreferences(profile.onboardingData),
      digest_opt_out: profile.digestOptOut,
      interview_sessions: readInterviewHistory(profile.onboardingData),
      guidance_history: readGuidanceHistory(profile.onboardingData).slice(0, 5),
      portal_expires_at: new Date(payload.exp).toISOString(),
      billing: await this.seekerBilling.getStatusForProfile(profile.id, profile.userId, profile),
    };
  }
}
