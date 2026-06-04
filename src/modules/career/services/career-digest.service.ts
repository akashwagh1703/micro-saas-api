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
    if (!profile?.isComplete || !profile.contact) {
      return;
    }

    const jobList = await this.jobs.listActive(profile.userId);
    const matches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      profile.userId,
      profile.id,
      profile.contactId,
      matches,
    );

    const top = matches.slice(0, 3);
    const name = profile.fullName ?? profile.contact.name ?? 'there';
    const lines = [
      `Good Morning ${name} 👋`,
      '',
      `${matches.length} matching jobs found today.`,
      '',
      'Top Matches:',
    ];

    top.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.job.title} at ${m.job.company} (${m.score}%)`);
    });

    lines.push(
      '',
      'Reply:',
      '• VIEW JOBS — see all matches',
      '• FIND JOBS {keyword} — search',
      '• SHOW APPLICATIONS — track applications',
      '• HELP — all commands',
    );

    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: profile.contactId },
    });
    if (!conversation) {
      return;
    }

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

  async runDailyDigestBatch(): Promise<void> {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { isComplete: true },
      select: { id: true },
    });

    for (const p of profiles) {
      try {
        await this.sendDailyDigestForProfile(p.id);
      } catch (e: any) {
        this.logger.error(`Daily digest failed for profile ${p.id}: ${e.message}`);
      }
    }
  }
}
