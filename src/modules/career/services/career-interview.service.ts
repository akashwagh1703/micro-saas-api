import { Injectable, Logger } from '@nestjs/common';
import { CareerProfile, Contact, Message } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { InboxService } from '../../inbox/inbox.service';
import {
  CAREER_BOT_MESSAGE_SOURCE,
  CAREER_INTERVIEW_TYPE_BUTTONS,
  CAREER_INTERVIEW_TYPE_LABELS,
  CareerInterviewType,
} from '../career.constants';
import {
  ActiveInterviewSession,
  InterviewHistoryEntry,
  MOCK_QUESTIONS_PER_SESSION,
  buildInterviewDataPatch,
  formatReadinessLabel,
  parseInterviewType,
  readActiveInterviewSession,
} from '../career-interview-state.util';
import { aggregateSessionTips, evaluateInterviewAnswerHeuristic } from '../career-interview-eval.util';
import { CareerAiService } from './career-ai.service';
import { CareerProfileService } from './career-profile.service';

@Injectable()
export class CareerInterviewService {
  private readonly logger = new Logger(CareerInterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly careerAi: CareerAiService,
    private readonly profiles: CareerProfileService,
  ) {}

  async hasActiveSession(profileId: number): Promise<boolean> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    return !!readActiveInterviewSession(profile?.onboardingData);
  }

  async cmdStart(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
    lower: string,
  ): Promise<void> {
    const jobIndex = this.parseMockJobIndex(lower);
    const job = jobIndex ? await this.resolveJobByIndex(profile, message.userId, jobIndex) : null;
    const roles = profile.preferredRoles as string[] | null;
    const role =
      job?.title ??
      roles?.[0] ??
      (lower
        .replace(/mock\s+interview|prepare\s+interview|interview\s+prep|interview\s+tips|practice\s+interview/gi, '')
        .replace(/\d+/g, '')
        .trim() || 'professional');

    const parsedType = parseInterviewType(text);

    if (!parsedType) {
      const session: ActiveInterviewSession = {
        status: 'choosing_type',
        role,
        jobId: job?.id,
        jobTitle: job?.title,
        company: job?.company,
        questions: [],
        currentIndex: 0,
        answers: [],
        startedAt: new Date().toISOString(),
      };
      await this.saveSession(profile.id, profile.onboardingData, session);

      const intro = job
        ? `Mock interview for *${job.title}* @ ${job.company} 🎯`
        : `Mock interview practice for *${role}* 🎯`;

      await this.reply(
        message,
        `${intro}\n\nChoose an interview type (tap a button or type *Managerial*):`,
      );
      await this.replyButtons(
        message,
        'Select interview round:',
        [...CAREER_INTERVIEW_TYPE_BUTTONS],
      );
      return;
    }

    await this.beginMockSession(message, profile, parsedType, role, job);
  }

  async handleAnswer(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
  ): Promise<boolean> {
    const fresh = await this.prisma.careerProfile.findFirst({
      where: { id: profile.id, userId: message.userId },
    });
    if (!fresh) {
      return false;
    }
    profile = fresh;

    const session = readActiveInterviewSession(profile.onboardingData);
    if (!session) {
      return false;
    }

    if (session.status === 'choosing_type') {
      const type = parseInterviewType(text);
      if (!type) {
        await this.reply(
          message,
          'Please pick an interview type: tap *HR*, *Technical*, or *Behavioral*, or type *Managerial*.\n\nReply *END INTERVIEW* to cancel.',
        );
        return true;
      }
      await this.beginMockSession(message, profile, type, session.role, {
        id: session.jobId,
        title: session.jobTitle,
        company: session.company,
        description: null,
      });
      return true;
    }

    if (text.trim().length < 8) {
      await this.reply(message, 'Please give a fuller answer (at least a sentence or two).');
      return true;
    }

    const question = session.questions[session.currentIndex];
    if (!question) {
      await this.finishSession(message, profile, session);
      return true;
    }

    await this.reply(message, 'Evaluating your answer… ⏳');

    const snapshot = this.profiles.profileSnapshot(profile);
    let evaluation = evaluateInterviewAnswerHeuristic({
      interviewType: session.type ?? 'technical',
      role: session.role,
      question,
      answer: text,
    });

    try {
      evaluation = await this.careerAi.evaluateMockInterviewAnswer(
        message.userId,
        session.type ?? 'technical',
        session.role,
        question,
        text,
        snapshot,
      );
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Interview eval failed profileId=${profile.id}: ${errMsg}`);
    }

    const answerRecord = {
      question,
      answer: text,
      score: evaluation.score,
      feedback: evaluation.feedback,
      tips: evaluation.tips,
      breakdown: evaluation.breakdown,
    };

    const updatedSession: ActiveInterviewSession = {
      ...session,
      answers: [...session.answers, answerRecord],
      currentIndex: session.currentIndex + 1,
    };

    const feedbackLines = [
      `*Score:* ${evaluation.score}/100`,
      evaluation.feedback,
    ];
    if (evaluation.tips.length > 0) {
      feedbackLines.push(`*Improve:* ${evaluation.tips[0]}`);
    }

    if (updatedSession.currentIndex >= updatedSession.questions.length) {
      await this.saveSession(profile.id, profile.onboardingData, updatedSession);
      await this.reply(message, feedbackLines.join('\n\n'));
      await this.finishSession(message, profile, updatedSession);
      return true;
    }

    await this.saveSession(profile.id, profile.onboardingData, updatedSession);
    const nextQuestion = updatedSession.questions[updatedSession.currentIndex];
    await this.reply(
      message,
      `${feedbackLines.join('\n\n')}\n\n*Question ${updatedSession.currentIndex + 1}/${updatedSession.questions.length}:*\n${nextQuestion}`,
    );
    return true;
  }

  async cmdEnd(message: Message & { contact: Contact }, profile: CareerProfile): Promise<void> {
    const fresh = await this.prisma.careerProfile.findFirst({
      where: { id: profile.id, userId: message.userId },
    });
    if (!fresh) {
      return;
    }
    profile = fresh;

    const session = readActiveInterviewSession(profile.onboardingData);
    if (!session) {
      await this.reply(message, 'No mock interview is in progress.');
      return;
    }

    if (session.answers.length > 0) {
      await this.finishSession(message, profile, session, true);
      return;
    }

    await this.clearSession(profile.id);
    await this.reply(message, 'Mock interview cancelled. Reply *MOCK INTERVIEW* anytime to practice again.');
  }

  async cmdStatus(message: Message & { contact: Contact }, profile: CareerProfile): Promise<void> {
    const fresh = await this.prisma.careerProfile.findFirst({
      where: { id: profile.id, userId: message.userId },
    });
    if (!fresh) {
      return;
    }
    profile = fresh;

    const session = readActiveInterviewSession(profile.onboardingData);
    if (!session) {
      await this.reply(
        message,
        'No mock interview in progress.\n\nReply *MOCK INTERVIEW* to start a 5-question practice session with scoring.',
      );
      return;
    }

    if (session.status === 'choosing_type') {
      await this.reply(
        message,
        `Mock interview setup for *${session.role}* — waiting for interview type.\n\nTap HR / Technical / Behavioral or type *Managerial*.`,
      );
      return;
    }

    const typeLabel = session.type ? CAREER_INTERVIEW_TYPE_LABELS[session.type] : 'Interview';
    await this.reply(
      message,
      `*${typeLabel}* mock in progress\n` +
        `Question ${Math.min(session.currentIndex + 1, session.questions.length)}/${session.questions.length}\n` +
        `Answers scored: ${session.answers.length}\n\n` +
        `Reply *END INTERVIEW* to stop early.`,
    );
  }

  private async beginMockSession(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    type: CareerInterviewType,
    role: string,
    job?: { id?: number; title?: string; company?: string; description?: string | null } | null,
  ): Promise<void> {
    const typeLabel = CAREER_INTERVIEW_TYPE_LABELS[type];
    await this.reply(message, `Starting *${typeLabel}* for *${role}*… generating questions ⏳`);

    const snapshot = this.profiles.profileSnapshot(profile);
    let questions: string[] = [];

    try {
      questions = await this.careerAi.generateMockInterviewQuestions(
        message.userId,
        type,
        role,
        snapshot,
        job?.title && job?.company
          ? { title: job.title, company: job.company, description: job.description }
          : undefined,
        MOCK_QUESTIONS_PER_SESSION,
      );
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Question generation failed profileId=${profile.id}: ${errMsg}`);
    }

    if (questions.length === 0) {
      await this.reply(message, 'Could not start mock interview right now. Please try again in a moment.');
      return;
    }

    const session: ActiveInterviewSession = {
      status: 'active',
      type,
      role,
      jobId: job?.id,
      jobTitle: job?.title,
      company: job?.company,
      questions,
      currentIndex: 0,
      answers: [],
      startedAt: new Date().toISOString(),
    };

    await this.saveSession(profile.id, profile.onboardingData, session);

    const header = job?.title
      ? `*${typeLabel}* — ${job.title} @ ${job.company}`
      : `*${typeLabel}* — ${role}`;

    await this.reply(
      message,
      `${header}\n\nI'll ask *${questions.length} questions*. Answer each in your own words.\n\n*Question 1/${questions.length}:*\n${questions[0]}\n\nReply *END INTERVIEW* anytime to stop.`,
    );
  }

  private async finishSession(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    session: ActiveInterviewSession,
    endedEarly = false,
  ): Promise<void> {
    const scores = session.answers.map((a) => a.score);
    const avgScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const readinessScore = avgScore;
    const readinessLabel = formatReadinessLabel(readinessScore);

    const historyEntry: InterviewHistoryEntry = {
      id: `int_${Date.now()}`,
      type: session.type ?? 'technical',
      typeLabel: session.type ? CAREER_INTERVIEW_TYPE_LABELS[session.type] : 'Interview',
      role: session.role,
      jobTitle: session.jobTitle,
      company: session.company,
      readinessScore,
      readinessLabel,
      questionCount: session.answers.length,
      avgAnswerScore: avgScore,
      completedAt: new Date().toISOString(),
      answers: session.answers,
    };

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: {
        onboardingData: buildInterviewDataPatch(
          (
            await this.prisma.careerProfile.findUnique({
              where: { id: profile.id },
              select: { onboardingData: true },
            })
          )?.onboardingData,
          {
            session: null,
            historyEntry,
          },
        ),
      },
    });

    const lines = [
      endedEarly ? '*Mock interview ended early*' : '*Mock interview complete* ✅',
      '',
      `*Interview Readiness Score:* ${readinessScore}/100`,
      `*${readinessLabel}*`,
      session.answers.length > 0
        ? `Average answer score: ${avgScore}/100 (${session.answers.length} question${session.answers.length === 1 ? '' : 's'})`
        : 'No answers scored.',
      '',
      '*Summary:*',
    ];

    session.answers.slice(0, 3).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.score}/100 — ${a.feedback.slice(0, 120)}${a.feedback.length > 120 ? '…' : ''}`);
    });

    const sessionTips = aggregateSessionTips(session.answers, 3);
    if (sessionTips.length > 0) {
      lines.push('', '*Practice tips for next time:*');
      sessionTips.forEach((tip, i) => lines.push(`${i + 1}. ${tip}`));
    }

    lines.push(
      '',
      'Reply *MOCK INTERVIEW* to practice again, or *MOCK INTERVIEW 1* to practice for job #1.',
    );

    await this.reply(message, lines.join('\n'));
  }

  private async saveSession(
    profileId: number,
    _existingData: unknown,
    session: ActiveInterviewSession,
  ): Promise<void> {
    const current = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        onboardingData: buildInterviewDataPatch(current?.onboardingData, { session }),
      },
    });
  }

  private async clearSession(profileId: number): Promise<void> {
    const current = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        onboardingData: buildInterviewDataPatch(current?.onboardingData, { session: null }),
      },
    });
  }

  private parseMockJobIndex(lower: string): number | null {
    const match = lower.match(/^(?:mock\s+interview|prepare\s+interview|interview\s+prep)\s*#?\s*(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
  }

  private async resolveJobByIndex(profile: CareerProfile, userId: number, index1Based: number) {
    const data = profile.onboardingData as Record<string, unknown> | null;
    const session = data?.job_session as { jobIds?: number[] } | undefined;
    const jobId = session?.jobIds?.[index1Based - 1];

    if (jobId) {
      return this.prisma.careerJob.findFirst({
        where: { id: jobId, userId, isActive: true },
      });
    }

    const matches = await this.prisma.careerJobMatch.findMany({
      where: { profileId: profile.id, userId, score: { gte: 70 } },
      orderBy: { score: 'desc' },
      take: 10,
      include: { job: true },
    });
    return matches[index1Based - 1]?.job ?? null;
  }

  private async reply(message: Message & { contact: Contact }, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) {
      return;
    }
    await this.inbox.sendOutgoingMessage(message.userId, conversation.id, text.slice(0, 3800), {
      source: CAREER_BOT_MESSAGE_SOURCE,
    });
  }

  private async replyButtons(
    message: Message & { contact: Contact },
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) {
      return;
    }
    await this.inbox.sendInteractiveButtons(message.userId, conversation.id, body, buttons, {
      source: CAREER_BOT_MESSAGE_SOURCE,
    });
  }
}
