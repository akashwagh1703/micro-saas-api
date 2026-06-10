import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerMatchingService, formatMatchScoreLabel } from './career-matching.service';
import { CareerJobService } from './career-job.service';
import { buildJobActionButtons } from '../career.constants';
import {
  buildProfileDataPatch,
  mergeNotifiedJobIds,
  readAlertState,
} from '../career-alert-state.util';
import { CareerAlertChannelService } from './career-alert-channel.service';
import { CareerSeekerBillingService } from './career-seeker-billing.service';

export interface DigestBatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

type DigestProfileOutcome = 'sent' | 'skipped' | 'failed';

@Injectable()
export class CareerDigestService {
  private readonly logger = new Logger(CareerDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: CareerMatchingService,
    private readonly jobs: CareerJobService,
    private readonly channels: CareerAlertChannelService,
    private readonly seekerBilling: CareerSeekerBillingService,
  ) {}

  /**
   * Sends the daily digest for one profile across enabled channels.
   */
  async sendDailyDigestForProfile(profileId: number): Promise<DigestProfileOutcome> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      include: { contact: true },
    });

    if (!profile?.isComplete || !profile.contact) {
      return 'skipped';
    }

    if (profile.digestOptOut) {
      this.logger.debug(`Digest skipped — profile ${profileId} opted out`);
      return 'skipped';
    }

    if (!(await this.seekerBilling.hasAccess(profile))) {
      this.logger.debug(`Digest skipped — profile ${profileId} subscription inactive`);
      return 'skipped';
    }

    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const alreadySentToday = await this.prisma.careerNotification.findFirst({
      where: {
        profileId,
        type: 'daily_digest',
        status: 'sent',
        sentAt: { gte: startOfTodayUtc },
      },
    });
    if (alreadySentToday) {
      this.logger.debug(`Digest skipped — profile ${profileId} already sent today`);
      return 'skipped';
    }

    try {
      const jobList = await this.jobs.listActive(profile.userId);
      const allMatches = this.matching.matchProfileToJobs(profile, jobList);
      await this.matching.persistMatches(
        profile.userId,
        profile.id,
        profile.contactId,
        allMatches,
      );
      const matches = this.matching.filterQualityMatches(allMatches);

      if (matches.length === 0) {
        await this.prisma.careerNotification.create({
          data: {
            userId: profile.userId,
            profileId: profile.id,
            contactId: profile.contactId,
            type: 'daily_digest',
            status: 'skipped',
            payload: {
              reason: allMatches.length > 0 ? 'low_match_scores' : 'no_matches',
              matchCount: 0,
              totalScored: allMatches.length,
            },
          },
        });
        return 'skipped';
      }

      const alertState = readAlertState(profile.onboardingData);
      const notifiedSet = new Set(alertState.notifiedJobIds);
      const unseenMatches = matches.filter((m) => !notifiedSet.has(m.job.id));
      const digestPool = unseenMatches.length > 0 ? unseenMatches : matches;
      const top = digestPool.slice(0, 3);
      const name = profile.fullName ?? profile.contact.name ?? 'there';
      const showingNew = unseenMatches.length > 0;

      const lines = [
        `Hi ${name} 👋 Your daily job matches are ready!`,
        '',
        showingNew
          ? `*${unseenMatches.length} new job${unseenMatches.length === 1 ? '' : 's'}* match your profile (70%+ fit).`
          : `*${matches.length} jobs* match your profile today.`,
        '',
        showingNew ? '*New Matches:*' : '*Top Matches:*',
      ];

      top.forEach((m, i) => {
        lines.push(
          `${i + 1}. *${m.job.title}* @ ${m.job.company}`,
          `   📍 ${m.job.location ?? '—'} | 💰 ${m.job.salaryText ?? '—'} | ${m.score}% — ${formatMatchScoreLabel(m.score)}`,
        );
      });

      lines.push(
        '',
        'Reply:',
        '• *APPLY 1* — save & get apply link',
        '• *COVER LETTER 1* — cover letter for a job',
        '• *JOB 1* — full job details',
        '• *VIEW JOBS* — see all matches',
        '• *PORTAL LINK* — open your web dashboard',
        '• *STOP DIGEST* — pause all job alerts',
      );

      const conversation = await this.prisma.conversation.findUnique({
        where: { contactId: profile.contactId },
      });

      const emailContent = this.channels.buildDigestEmailContent(
        profile,
        top,
        matches.length,
        showingNew,
        unseenMatches.length,
      );

      const delivery = await this.channels.deliver(
        profile,
        {
          notificationType: 'daily_digest',
          title: 'Daily Job Digest',
          whatsappBody: lines.join('\n'),
          emailSubject: emailContent.emailSubject,
          emailText: emailContent.emailText,
          emailHtml: emailContent.emailHtml,
          inAppSummary: emailContent.inAppSummary,
          jobs: this.channels.buildJobSummaries(top),
          payloadExtras: {
            matchCount: matches.length,
            newMatchCount: unseenMatches.length,
            topJobIds: top.map((t) => t.job.id),
            showingNew,
          },
        },
        {
          conversationId: conversation?.id,
          buttons: buildJobActionButtons(top.length),
          buttonPrompt: 'Quick actions for today\'s top matches:',
        },
      );

      if (!delivery.primarySuccess) {
        return delivery.whatsapp === 'failed' && delivery.email === 'failed' ? 'failed' : 'skipped';
      }

      await this.prisma.careerProfile.update({
        where: { id: profile.id },
        data: {
          onboardingData: buildProfileDataPatch(profile.onboardingData, {
            alertState: {
              notifiedJobIds: mergeNotifiedJobIds(
                alertState.notifiedJobIds,
                top.map((t) => t.job.id),
              ),
              lastDigestAt: new Date().toISOString(),
            },
            jobSessionJobIds: top.map((t) => t.job.id),
          }),
        },
      });

      return 'sent';
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Daily digest failed for profile ${profileId}: ${message}`);
      await this.prisma.careerNotification.create({
        data: {
          userId: profile.userId,
          profileId: profile.id,
          contactId: profile.contactId,
          type: 'daily_digest',
          status: 'failed',
          payload: { reason: 'exception', error: message },
        },
      });
      return 'failed';
    }
  }

  async runDailyDigestForUser(userId: number): Promise<DigestBatchResult> {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true, digestOptOut: false },
      select: { id: true },
    });

    const result: DigestBatchResult = { sent: 0, skipped: 0, failed: 0 };

    for (const p of profiles) {
      const outcome = await this.sendDailyDigestForProfile(p.id);
      if (outcome === 'sent') {
        result.sent++;
      } else if (outcome === 'failed') {
        result.failed++;
      } else {
        result.skipped++;
      }
    }

    return result;
  }

  async runDailyDigestBatch(): Promise<DigestBatchResult> {
    const settings = await this.prisma.userSetting.findMany({
      where: { key: 'business_category', value: 'career_ai' },
      select: { userId: true },
    });

    const totals: DigestBatchResult = { sent: 0, skipped: 0, failed: 0 };

    for (const { userId } of settings) {
      try {
        const r = await this.runDailyDigestForUser(userId);
        totals.sent += r.sent;
        totals.skipped += r.skipped;
        totals.failed += r.failed;
        this.logger.log(
          `Digest userId=${userId}: sent=${r.sent} skipped=${r.skipped} failed=${r.failed}`,
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Digest batch failed for userId=${userId}: ${message}`);
        totals.failed++;
      }
    }

    return totals;
  }
}
