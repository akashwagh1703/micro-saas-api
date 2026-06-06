import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerMatchingService } from './career-matching.service';
import { CareerJobService } from './career-job.service';
import { InboxService } from '../../inbox/inbox.service';

export interface DigestBatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class CareerDigestService {
  private readonly logger = new Logger(CareerDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: CareerMatchingService,
    private readonly jobs: CareerJobService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * Sends the daily digest for one profile. Returns true only when a WhatsApp
   * message was actually delivered.
   */
  async sendDailyDigestForProfile(profileId: number): Promise<boolean> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      include: { contact: true },
    });

    if (!profile?.isComplete || !profile.contact) {
      return false;
    }

    if (profile.digestOptOut) {
      this.logger.debug(`Digest skipped — profile ${profileId} opted out`);
      return false;
    }

    try {
      const jobList = await this.jobs.listActive(profile.userId);
      const matches = this.matching.matchProfileToJobs(profile, jobList);
      await this.matching.persistMatches(
        profile.userId,
        profile.id,
        profile.contactId,
        matches,
      );

      if (matches.length === 0) {
        await this.recordNotification(profile, 'skipped', {
          reason: 'no_matches',
          matchCount: 0,
        });
        return false;
      }

      const top = matches.slice(0, 3);
      const name = profile.fullName ?? profile.contact.name ?? 'there';

      const lines = [
        `Hi ${name} 👋 Your daily job matches are ready!`,
        '',
        `*${matches.length} jobs* match your profile today.`,
        '',
        '*Top Matches:*',
      ];

      top.forEach((m, i) => {
        lines.push(
          `${i + 1}. *${m.job.title}* @ ${m.job.company}`,
          `   📍 ${m.job.location ?? '—'} | 💰 ${m.job.salaryText ?? '—'} | ${m.score}% match`,
        );
      });

      lines.push(
        '',
        'Reply:',
        '• *VIEW JOBS* — see all matches',
        '• *FIND JOBS {keyword}* — search by role',
        '• *GENERATE RESUME* — tailor CV for top match',
        '• *STOP DIGEST* — unsubscribe from daily updates',
      );

      const conversation = await this.prisma.conversation.findUnique({
        where: { contactId: profile.contactId },
      });
      if (!conversation) {
        await this.recordNotification(profile, 'failed', {
          reason: 'no_conversation',
          matchCount: matches.length,
        });
        return false;
      }

      const sendResult = await this.inbox.sendOutgoingMessage(
        profile.userId,
        conversation.id,
        lines.join('\n'),
      );

      if (!sendResult.success) {
        await this.recordNotification(profile, 'failed', {
          reason: 'whatsapp_send_failed',
          error: sendResult.error,
          matchCount: matches.length,
        });
        return false;
      }

      await this.recordNotification(profile, 'sent', {
        matchCount: matches.length,
        topJobIds: top.map((t) => t.job.id),
      });

      return true;
    } catch (e: any) {
      this.logger.error(`Daily digest failed for profile ${profileId}: ${e.message}`);
      await this.recordNotification(profile, 'failed', {
        reason: 'exception',
        error: e.message,
      });
      return false;
    }
  }

  async runDailyDigestForUser(userId: number): Promise<DigestBatchResult> {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true, digestOptOut: false },
      select: { id: true },
    });

    const result: DigestBatchResult = { sent: 0, skipped: 0, failed: 0 };

    for (const p of profiles) {
      try {
        const ok = await this.sendDailyDigestForProfile(p.id);
        if (ok) {
          result.sent++;
        } else {
          result.skipped++;
        }
      } catch {
        result.failed++;
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
      } catch (e: any) {
        this.logger.error(`Digest batch failed for userId=${userId}: ${e.message}`);
        totals.failed++;
      }
    }

    return totals;
  }

  private async recordNotification(
    profile: { userId: number; id: number; contactId: number },
    status: 'sent' | 'skipped' | 'failed',
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.careerNotification.create({
      data: {
        userId: profile.userId,
        profileId: profile.id,
        contactId: profile.contactId,
        type: 'daily_digest',
        status,
        sentAt: status === 'sent' ? new Date() : null,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}
