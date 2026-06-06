import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerMatchingService } from './career-matching.service';
import { CareerJobService } from './career-job.service';
import { CareerProfileService } from './career-profile.service';
import { InboxService } from '../../inbox/inbox.service';

@Injectable()
export class CareerDigestService {
  private readonly logger = new Logger(CareerDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: CareerMatchingService,
    private readonly jobs: CareerJobService,
    private readonly profiles: CareerProfileService,
    private readonly inbox: InboxService,
  ) {}

  async sendDailyDigestForProfile(profileId: number): Promise<void> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      include: { contact: true },
    });

    if (!profile?.isComplete || !profile.contact) return;

    // FIX 1: Respect digest opt-out flag added in Phase 1.
    if ((profile as any).digestOptOut === true) return;

    const jobList = await this.jobs.listActive(profile.userId);
    const matches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      profile.userId,
      profile.id,
      profile.contactId,
      matches,
    );

    if (matches.length === 0) return;

    const top = matches.slice(0, 3);
    const name = profile.fullName ?? profile.contact.name ?? 'there';

    // FIX 5: Removed time-specific "Good Morning" — digest may run at any UTC
    // hour and the candidate's local time is unknown.
    const lines = [
      `Hi ${name} 👋 Your daily job matches are ready!`,
      '',
      `*${matches.length} jobs* match your profile today.`,
      '',
      '*Top Matches:*',
    ];

    // FIX 6: Include location and salary so the user has actionable context.
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
    if (!conversation) return;

    await this.inbox.sendOutgoingMessage(profile.userId, conversation.id, lines.join('\n'));

    await this.prisma.careerNotification.create({
      data: {
        userId: profile.userId,
        profileId: profile.id,
        contactId: profile.contactId,
        type: 'daily_digest',
        status: 'sent',
        sentAt: new Date(),
        payload: { matchCount: matches.length, topJobIds: top.map((t) => t.job.id) },
      },
    });
  }

  /**
   * FIX 2: Scoped to a single userId so each tenant's digest runs independently.
   * The scheduler calls this once per tenant — not once for all tenants globally.
   * This prevents one slow tenant from blocking all others and isolates failures.
   */
  async runDailyDigestForUser(userId: number): Promise<number> {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true },
      select: { id: true },
    });

    let sent = 0;
    for (const p of profiles) {
      try {
        await this.sendDailyDigestForProfile(p.id);
        sent++;
      } catch (e: any) {
        this.logger.error(`Daily digest failed for profile ${p.id}: ${e.message}`);
      }
    }
    return sent;
  }

  /**
   * Global batch — kept for the portal's manual "Run digest" button.
   * Iterates over all career_ai tenants and calls runDailyDigestForUser for each.
   */
  async runDailyDigestBatch(): Promise<void> {
    const settings = await this.prisma.userSetting.findMany({
      where: { key: 'business_category', value: 'career_ai' },
      select: { userId: true },
    });

    for (const { userId } of settings) {
      try {
        const sent = await this.runDailyDigestForUser(userId);
        this.logger.log(`Digest sent to ${sent} profile(s) for userId=${userId}`);
      } catch (e: any) {
        this.logger.error(`Digest batch failed for userId=${userId}: ${e.message}`);
      }
    }
  }
}
