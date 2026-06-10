import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareerProfile, Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CareerMatchingService,
  JobMatchResult,
  formatMatchScoreLabel,
} from './career-matching.service';
import { CareerJobService } from './career-job.service';
import { buildJobActionButtons } from '../career.constants';
import {
  buildProfileDataPatch,
  mergeNotifiedJobIds,
  readAlertState,
} from '../career-alert-state.util';
import { CareerAlertChannelService } from './career-alert-channel.service';

export interface JobAlertBatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

type AlertOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Instant alerts when a job refresh ingests new listings that match
 * a seeker profile at 70%+ (CareerAI.md Step 10 — Smart Job Alerts).
 */
@Injectable()
export class CareerJobAlertService {
  private readonly logger = new Logger(CareerJobAlertService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly matching: CareerMatchingService,
    private readonly jobs: CareerJobService,
    private readonly channels: CareerAlertChannelService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('CAREER_INSTANT_ALERTS_ENABLED') !== 'false';
  }

  private cooldownMs(): number {
    const hours = parseInt(this.config.get<string>('CAREER_ALERT_COOLDOWN_HOURS') ?? '4', 10);
    return (Number.isNaN(hours) || hours < 1 ? 4 : hours) * 3_600_000;
  }

  /** Notify all complete profiles on a tenant when new jobs were ingested. */
  async processNewJobsForUser(userId: number, newJobIds: number[]): Promise<JobAlertBatchResult> {
    const result: JobAlertBatchResult = { sent: 0, skipped: 0, failed: 0 };

    if (!this.isEnabled() || newJobIds.length === 0) {
      return result;
    }

    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true, digestOptOut: false },
      include: { contact: true },
    });

    for (const profile of profiles) {
      const outcome = await this.sendInstantAlertForProfile(profile, newJobIds);
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'failed') result.failed++;
      else result.skipped++;
    }

    if (result.sent > 0) {
      this.logger.log(
        `Instant job alerts userId=${userId}: sent=${result.sent} skipped=${result.skipped} failed=${result.failed} (${newJobIds.length} new jobs ingested)`,
      );
    }

    return result;
  }

  async sendInstantAlertForProfile(
    profile: CareerProfile & { contact: Contact | null },
    newJobIds: number[],
  ): Promise<AlertOutcome> {
    if (!profile.contact || profile.digestOptOut) {
      return 'skipped';
    }

    const state = readAlertState(profile.onboardingData);
    if (state.lastInstantAlertAt) {
      const elapsed = Date.now() - new Date(state.lastInstantAlertAt).getTime();
      if (elapsed < this.cooldownMs()) {
        return 'skipped';
      }
    }

    const newJobSet = new Set(newJobIds);
    const notifiedSet = new Set(state.notifiedJobIds);
    const candidateJobs = (await this.jobs.listActive(profile.userId)).filter((j) =>
      newJobSet.has(j.id),
    );

    if (candidateJobs.length === 0) {
      return 'skipped';
    }

    try {
      const allMatches = this.matching.matchProfileToJobs(profile, candidateJobs);
      await this.matching.persistMatches(
        profile.userId,
        profile.id,
        profile.contactId,
        allMatches,
      );

      const matches = this.matching
        .filterQualityMatches(allMatches)
        .filter((m) => !notifiedSet.has(m.job.id));

      if (matches.length === 0) {
        return 'skipped';
      }

      const top = matches.slice(0, 3);
      const conversation = await this.prisma.conversation.findUnique({
        where: { contactId: profile.contactId },
      });

      const whatsappBody = this.formatInstantAlertMessage(profile, top, matches.length);
      const emailContent = this.channels.buildInstantEmailContent(profile, top, matches.length);

      const delivery = await this.channels.deliver(
        profile,
        {
          notificationType: 'job_alert',
          title: 'New Job Alert',
          whatsappBody,
          emailSubject: emailContent.emailSubject,
          emailText: emailContent.emailText,
          emailHtml: emailContent.emailHtml,
          inAppSummary: emailContent.inAppSummary,
          jobs: this.channels.buildJobSummaries(top),
          payloadExtras: {
            matchCount: matches.length,
            alertedJobIds: top.map((m) => m.job.id),
            newJobIds,
          },
        },
        {
          conversationId: conversation?.id,
          buttons: buildJobActionButtons(top.length),
          buttonPrompt: 'Apply or get a cover letter:',
        },
      );

      if (!delivery.primarySuccess) {
        return delivery.whatsapp === 'failed' && delivery.email === 'failed' ? 'failed' : 'skipped';
      }

      const notifiedIds = mergeNotifiedJobIds(
        state.notifiedJobIds,
        top.map((m) => m.job.id),
      );

      await this.prisma.careerProfile.update({
        where: { id: profile.id },
        data: {
          onboardingData: buildProfileDataPatch(profile.onboardingData, {
            alertState: {
              notifiedJobIds: notifiedIds,
              lastInstantAlertAt: new Date().toISOString(),
            },
            jobSessionJobIds: top.map((m) => m.job.id),
          }),
        },
      });

      return 'sent';
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Instant alert failed profileId=${profile.id}: ${message}`);
      await this.prisma.careerNotification.create({
        data: {
          userId: profile.userId,
          profileId: profile.id,
          contactId: profile.contactId,
          type: 'job_alert',
          status: 'failed',
          payload: { reason: 'exception', error: message, newJobIds } as Prisma.InputJsonValue,
        },
      });
      return 'failed';
    }
  }

  private formatInstantAlertMessage(
    profile: CareerProfile & { contact: Contact | null },
    top: JobMatchResult[],
    totalNewMatches: number,
  ): string {
    const name = profile.fullName ?? profile.contact?.name ?? 'there';
    const lines = [
      `🔔 *New Job Alert* — Hi ${name}!`,
      '',
      totalNewMatches === 1
        ? 'A new opening matches your profile:'
        : `*${totalNewMatches} new jobs* match your profile (70%+ fit).`,
      '',
    ];

    top.forEach((m, i) => {
      lines.push(
        `*${i + 1}. ${m.job.title}* @ ${m.job.company}`,
        `📍 ${m.job.location ?? m.job.city ?? '—'} | 💰 ${m.job.salaryText ?? '—'}`,
        `🎯 *${m.score}%* — ${formatMatchScoreLabel(m.score)}`,
      );
      if (m.matchFactors.length > 0) {
        lines.push(`   ${m.matchFactors.slice(0, 2).join(' · ')}`);
      }
      lines.push('');
    });

    lines.push(
      'Reply *APPLY 1* to save & apply, *COVER LETTER 1* for a cover letter, or *JOB 1* for full details.',
      'Reply *PORTAL LINK* for your web dashboard · *STOP DIGEST* to pause alerts.',
    );

    return lines.join('\n');
  }
}
