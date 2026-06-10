import { Injectable, Logger } from '@nestjs/common';
import { CareerProfile, Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { InboxService } from '../../inbox/inbox.service';
import { CAREER_BOT_MESSAGE_SOURCE } from '../career.constants';
import { readAlertPreferences } from '../career-alert-preferences.util';
import { JobMatchResult, formatMatchScoreLabel } from './career-matching.service';
import { CareerEmailService } from './career-email.service';

export type AlertChannel = 'whatsapp' | 'email' | 'in_app';
export type ChannelStatus = 'sent' | 'skipped' | 'failed';

export interface JobAlertJobSummary {
  id: number;
  title: string;
  company: string;
  score: number;
  location?: string | null;
  salaryText?: string | null;
}

export interface MultiChannelAlertContent {
  notificationType: 'job_alert' | 'daily_digest';
  title: string;
  whatsappBody: string;
  emailSubject: string;
  emailText: string;
  emailHtml: string;
  inAppSummary: string;
  jobs: JobAlertJobSummary[];
  payloadExtras?: Record<string, unknown>;
}

export interface MultiChannelDeliveryResult {
  whatsapp: ChannelStatus;
  email: ChannelStatus;
  in_app: ChannelStatus;
  primarySuccess: boolean;
}

@Injectable()
export class CareerAlertChannelService {
  private readonly logger = new Logger(CareerAlertChannelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly email: CareerEmailService,
  ) {}

  buildJobSummaries(matches: JobMatchResult[]): JobAlertJobSummary[] {
    return matches.map((m) => ({
      id: m.job.id,
      title: m.job.title,
      company: m.job.company,
      score: m.score,
      location: m.job.location ?? m.job.city,
      salaryText: m.job.salaryText,
    }));
  }

  buildInstantEmailContent(
    profile: CareerProfile & { contact: Contact | null },
    top: JobMatchResult[],
    totalNewMatches: number,
  ): Pick<MultiChannelAlertContent, 'emailSubject' | 'emailText' | 'emailHtml' | 'inAppSummary'> {
    const name = profile.fullName ?? profile.contact?.name ?? 'there';
    const subject =
      totalNewMatches === 1
        ? `New job match: ${top[0]?.job.title ?? 'CareerAI'}`
        : `${totalNewMatches} new jobs match your profile`;

    const lines = [
      `Hi ${name},`,
      '',
      totalNewMatches === 1
        ? 'A new opening matches your profile:'
        : `${totalNewMatches} new jobs match your profile (70%+ fit).`,
      '',
    ];

    top.forEach((m, i) => {
      lines.push(
        `${i + 1}. ${m.job.title} @ ${m.job.company}`,
        `   Location: ${m.job.location ?? m.job.city ?? '—'} | Salary: ${m.job.salaryText ?? '—'}`,
        `   Match: ${m.score}% — ${formatMatchScoreLabel(m.score)}`,
        '',
      );
    });

    lines.push(
      'Reply on WhatsApp with APPLY 1, COVER LETTER 1, or open your candidate portal for details.',
    );

    const text = lines.join('\n');
    const html = [
      `<p>Hi ${name},</p>`,
      `<p>${totalNewMatches === 1 ? 'A new opening matches your profile:' : `${totalNewMatches} new jobs match your profile (70%+ fit).`}</p>`,
      '<ul>',
      ...top.map(
        (m) =>
          `<li><strong>${m.job.title}</strong> @ ${m.job.company}<br>` +
          `${m.job.location ?? '—'} · ${m.job.salaryText ?? '—'} · ${m.score}% match</li>`,
      ),
      '</ul>',
      '<p>Reply on WhatsApp or use your candidate portal to apply.</p>',
    ].join('');

    return {
      emailSubject: subject,
      emailText: text,
      emailHtml: html,
      inAppSummary: `${totalNewMatches} new job${totalNewMatches === 1 ? '' : 's'} — top: ${top[0]?.job.title ?? 'match'}`,
    };
  }

  buildDigestEmailContent(
    profile: CareerProfile & { contact: Contact | null },
    top: JobMatchResult[],
    matchCount: number,
    showingNew: boolean,
    unseenCount: number,
  ): Pick<MultiChannelAlertContent, 'emailSubject' | 'emailText' | 'emailHtml' | 'inAppSummary'> {
    const name = profile.fullName ?? profile.contact?.name ?? 'there';
    const subject = showingNew
      ? `Daily matches: ${unseenCount} new job${unseenCount === 1 ? '' : 's'} for you`
      : `Your daily job matches (${matchCount} total)`;

    const intro = showingNew
      ? `${unseenCount} new job${unseenCount === 1 ? '' : 's'} match your profile today.`
      : `${matchCount} jobs match your profile today.`;

    const lines = [`Hi ${name},`, '', intro, '', 'Top matches:', ''];
    top.forEach((m, i) => {
      lines.push(
        `${i + 1}. ${m.job.title} @ ${m.job.company}`,
        `   ${m.job.location ?? '—'} · ${m.job.salaryText ?? '—'} · ${m.score}%`,
        '',
      );
    });

    const text = lines.join('\n');
    const html = [
      `<p>Hi ${name},</p>`,
      `<p>${intro}</p>`,
      '<ol>',
      ...top.map(
        (m) =>
          `<li><strong>${m.job.title}</strong> @ ${m.job.company} — ${m.score}% match</li>`,
      ),
      '</ol>',
    ].join('');

    return {
      emailSubject: subject,
      emailText: text,
      emailHtml: html,
      inAppSummary: showingNew
        ? `Daily digest: ${unseenCount} new matches`
        : `Daily digest: ${matchCount} matches`,
    };
  }

  async deliver(
    profile: CareerProfile & { contact: Contact | null },
    content: MultiChannelAlertContent,
    options?: {
      conversationId?: number | null;
      buttons?: Array<{ id: string; title: string }>;
      buttonPrompt?: string;
    },
  ): Promise<MultiChannelDeliveryResult> {
    const prefs = readAlertPreferences(profile.onboardingData);
    const result: MultiChannelDeliveryResult = {
      whatsapp: 'skipped',
      email: 'skipped',
      in_app: 'skipped',
      primarySuccess: false,
    };

    if (profile.digestOptOut) {
      return result;
    }

    if (prefs.whatsapp && profile.contact && options?.conversationId) {
      const sendResult = await this.inbox.sendOutgoingMessage(
        profile.userId,
        options.conversationId,
        content.whatsappBody,
      );
      result.whatsapp = sendResult.success ? 'sent' : 'failed';

      if (sendResult.success && options.buttons?.length) {
        await this.inbox.sendInteractiveButtons(
          profile.userId,
          options.conversationId,
          options.buttonPrompt ?? 'Quick actions:',
          options.buttons,
          { source: CAREER_BOT_MESSAGE_SOURCE },
        );
      }
    }

    if (prefs.email && profile.email?.trim() && this.email.isEnabled()) {
      const emailResult = await this.email.send({
        to: profile.email.trim(),
        subject: content.emailSubject,
        text: content.emailText,
        html: content.emailHtml,
      });
      result.email = emailResult.success ? 'sent' : 'failed';
    } else if (prefs.email && profile.email?.trim() && !this.email.isEnabled()) {
      result.email = 'skipped';
    }

    if (prefs.in_app) {
      result.in_app = 'sent';
    }

    result.primarySuccess =
      result.whatsapp === 'sent' || result.email === 'sent' || result.in_app === 'sent';

    await this.recordNotification(profile, content, result);

    if (!result.primarySuccess) {
      this.logger.warn(
        `Multi-channel alert had no successful channel profileId=${profile.id} channels=${JSON.stringify(result)}`,
      );
    }

    return result;
  }

  private async recordNotification(
    profile: { userId: number; id: number; contactId: number },
    content: MultiChannelAlertContent,
    channels: Omit<MultiChannelDeliveryResult, 'primarySuccess'>,
  ): Promise<void> {
    const anySent = channels.whatsapp === 'sent' || channels.email === 'sent' || channels.in_app === 'sent';
    const allSkipped =
      channels.whatsapp === 'skipped' &&
      channels.email === 'skipped' &&
      channels.in_app === 'skipped';

    await this.prisma.careerNotification.create({
      data: {
        userId: profile.userId,
        profileId: profile.id,
        contactId: profile.contactId,
        type: content.notificationType,
        status: anySent ? 'sent' : allSkipped ? 'skipped' : 'failed',
        sentAt: anySent ? new Date() : null,
        payload: {
          title: content.title,
          summary: content.inAppSummary,
          jobs: content.jobs,
          channels,
          ...content.payloadExtras,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
