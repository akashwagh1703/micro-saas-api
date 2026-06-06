import { Injectable, Logger } from '@nestjs/common';
import { Contact, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { InboxService } from '../../inbox/inbox.service';
import { CAREER_COMMANDS } from '../career.constants';
import { CareerProfileService } from './career-profile.service';
import { CareerJobService } from './career-job.service';
import { CareerMatchingService } from './career-matching.service';
import { CareerAiService } from './career-ai.service';
import { CareerResumeParserService } from './career-resume-parser.service';
import { CareerStorageService } from './career-storage.service';
import { CareerApplicationService } from './career-application.service';
import { CareerProfile } from '@prisma/client';

@Injectable()
export class CareerBotService {
  private readonly logger = new Logger(CareerBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly inbox: InboxService,
    private readonly profiles: CareerProfileService,
    private readonly jobs: CareerJobService,
    private readonly matching: CareerMatchingService,
    private readonly careerAi: CareerAiService,
    private readonly resumeParser: CareerResumeParserService,
    private readonly storage: CareerStorageService,
    private readonly applications: CareerApplicationService,
  ) {}

  async handleIncomingMessage(message: Message & { contact: Contact }): Promise<boolean> {
    const raw = (message.metadata as { raw?: Record<string, unknown> })?.raw;
    const isDocument = raw && String((raw as any).type) === 'document';

    const profile = await this.profiles.getOrCreate(message.userId, message.contact);
    await this.jobs.ensureSampleJobs(message.userId);

    if (isDocument && ['welcome', 'awaiting_resume'].includes(profile.onboardingStep)) {
      await this.handleResumeDocument(message, profile);
      return true;
    }

    const text = String(message.content).trim();
    const lower = text.toLowerCase();

    if (!profile.isComplete) {
      await this.handleOnboarding(message, profile, text);
      return true;
    }

    if (this.matchesCommand(lower, CAREER_COMMANDS.FIND_JOBS)) {
      await this.cmdFindJobs(message, profile, text);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.SHOW_APPLICATIONS)) {
      await this.cmdShowApplications(message, profile);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.GENERATE_RESUME)) {
      await this.cmdGenerateResume(message, profile);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.GENERATE_COVER_LETTER)) {
      await this.cmdGenerateCoverLetter(message, profile);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.IMPROVE_RESUME)) {
      await this.reply(message, 'Share one section to improve (e.g. "experience" or "skills") and I will suggest edits.');
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.CAREER_ADVICE)) {
      const advice = await this.careerAi.careerAdvice(
        message.userId,
        text,
        this.profiles.profileSnapshot(profile),
      );
      await this.reply(message, advice);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.PREPARE_INTERVIEW)) {
      const role = profile.preferredRoles
        ? (profile.preferredRoles as string[])[0]
        : 'software developer';
      const prep = await this.careerAi.interviewPrep(
        message.userId,
        role,
        this.profiles.profileSnapshot(profile),
      );
      await this.reply(message, prep);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.VIEW_JOBS) || this.matchesCommand(lower, CAREER_COMMANDS.HELP)) {
      if (this.matchesCommand(lower, CAREER_COMMANDS.HELP)) {
        await this.reply(message, this.helpText());
      } else {
        await this.cmdFindJobs(message, profile, 'all');
      }
      return true;
    }

    if (lower.startsWith('find ') || lower.includes(' jobs')) {
      await this.cmdFindJobs(message, profile, text);
      return true;
    }

    await this.reply(
      message,
      `Hi! I'm CareerAI 🎯\n\n${this.helpText()}`,
    );
    return true;
  }

  private async handleOnboarding(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
  ): Promise<void> {
    if (profile.onboardingStep === 'welcome') {
      await this.profiles.updateOnboarding(profile.id, 'awaiting_resume', {});
      await this.reply(
        message,
        'Welcome to CareerAI Bot! 🎯\n\nPlease upload your latest resume (PDF or DOCX).',
      );
      return;
    }

    if (profile.onboardingStep === 'awaiting_resume') {
      await this.reply(message, 'Please upload your resume as a PDF or DOCX document attachment.');
      return;
    }

    // Recovery: profile got stuck at parsing_resume (AI timed out or extracted empty text).
    // Move forward so the user is never permanently locked.
    if (profile.onboardingStep === 'parsing_resume') {
      await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
      await this.reply(
        message,
        'Let\'s continue setting up your profile.\n\nWhat is your current city/location? (e.g. Mumbai, Pune)',
      );
      return;
    }

    const steps: Record<string, { next: string; field: keyof CareerProfile; question: string }> = {
      // FIXED: each question now matches the field it saves into.
      follow_up_location: {
        next: 'follow_up_preferred_location',
        field: 'currentLocation',
        question: 'What is your current city/location? (e.g. Mumbai, Pune)',
      },
      follow_up_preferred_location: {
        next: 'follow_up_current_salary',
        field: 'preferredLocations',
        question: 'Where would you prefer to work? (city or "Remote", comma-separated if multiple)',
      },
      follow_up_current_salary: {
        next: 'follow_up_expected_salary',
        field: 'currentSalary',
        question: 'What is your current salary? (e.g. 8 LPA or "Fresher")',
      },
      follow_up_expected_salary: {
        next: 'follow_up_notice_period',
        field: 'expectedSalary',
        question: 'What is your expected salary? (e.g. 12 LPA or "Negotiable")',
      },
      follow_up_notice_period: {
        next: 'follow_up_job_type',
        field: 'noticePeriod',
        question: 'What is your notice period? (e.g. 30 days, 2 months, Immediate)',
      },
      follow_up_job_type: {
        next: 'follow_up_roles',
        field: 'workPreference',
        question: 'Preferred work mode? Reply: *Remote*, *Hybrid*, or *Onsite*',
      },
      follow_up_roles: {
        next: 'complete',
        field: 'preferredRoles',
        question: '',
      },
    };

    const step = steps[profile.onboardingStep];
    if (!step) {
      // Unknown step — should not happen, but recover gracefully.
      this.logger.warn(`Unknown onboarding step "${profile.onboardingStep}" for profile ${profile.id}`);
      await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
      await this.reply(message, 'Let\'s continue. What is your current city/location?');
      return;
    }

    const data: Prisma.CareerProfileUpdateInput = {};
    if (step.field === 'preferredLocations' || step.field === 'preferredRoles') {
      data[step.field] = text.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      data[step.field] = text;
    }

    const updated = await this.profiles.updateOnboarding(profile.id, step.next, data);

    if (step.next === 'complete') {
      await this.profiles.markComplete(profile.id);
      const jobList = await this.jobs.listActive(message.userId);
      const matches = this.matching.matchProfileToJobs(updated, jobList);
      await this.matching.persistMatches(
        message.userId,
        profile.id,
        message.contactId,
        matches,
      );
      await this.reply(
        message,
        `Your Career Profile is ready! ✅\n\nI found ${matches.length} matching jobs.\n\nReply *VIEW JOBS* or *FIND JOBS react* to explore.\n${this.helpText()}`,
      );
      return;
    }

    await this.reply(message, step.question);
  }

  private async handleResumeDocument(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    await this.reply(message, 'Thanks! Reading your resume… ⏳');

    const raw = (message.metadata as { raw?: any })?.raw;
    const doc = raw?.document;
    const mediaId = doc?.id;
    if (!mediaId) {
      await this.reply(message, 'Could not read the file. Please upload PDF or DOCX again.');
      return;
    }

    const creds = await this.whatsapp.credentials(message.userId);
    if (!creds?.accessToken) {
      await this.reply(message, 'WhatsApp is not connected. Please contact support.');
      return;
    }

    const downloaded = await this.whatsAppApi.downloadMedia(
      creds.accessToken ?? '',
      mediaId,
    );
    if (!downloaded.success || !downloaded.buffer) {
      await this.reply(message, 'Failed to download resume. Please try again.');
      return;
    }

    const mime = doc.mime_type ?? 'application/pdf';
    const fileName = doc.filename ?? 'resume.pdf';
    const filePath = await this.storage.saveBuffer(
      message.userId,
      'resumes',
      fileName,
      downloaded.buffer,
    );

    const extracted = await this.resumeParser.extractText(downloaded.buffer, mime, fileName);

    // Clear the isMaster flag on any existing resumes before creating the new master.
    await this.prisma.careerResume.updateMany({
      where: { profileId: profile.id, isMaster: true },
      data: { isMaster: false },
    });

    const resume = await this.prisma.careerResume.create({
      data: {
        userId: message.userId,
        profileId: profile.id,
        contactId: message.contactId,
        type: 'upload',
        fileName,
        mimeType: mime,
        filePath,
        extractedText: extracted,
        isMaster: true,
      },
    });

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: { masterResumeId: resume.id, onboardingStep: 'parsing_resume' },
    });

    const parsed = extracted
      ? await this.careerAi.parseResume(message.userId, extracted)
      : null;

    if (parsed) {
      const updated = await this.profiles.applyParsedResume(profile.id, parsed);
      await this.reply(
        message,
        `Resume parsed! ✅\n\nHi ${updated.fullName ?? 'there'}, I extracted your skills and experience.\n\nWhat is your current location?`,
      );
      return;
    }

    await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
    await this.reply(
      message,
      'Resume saved. I could not auto-parse all fields.\n\nWhat is your current location?',
    );
  }

  private async cmdFindJobs(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
  ): Promise<void> {
    let jobList = await this.jobs.listActive(message.userId);
    const keyword = this.extractJobKeyword(text);
    if (keyword && keyword !== 'all' && keyword.length > 1) {
      jobList = this.jobs.searchByKeyword(jobList, keyword);
    }

    const matches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      message.userId,
      profile.id,
      message.contactId,
      matches,
    );

    if (matches.length === 0) {
      await this.reply(message, 'No matching jobs found. Try another keyword like "React" or "Laravel".');
      return;
    }

    const lines = [`Found ${matches.length} matching jobs:\n`];
    matches.slice(0, 10).forEach((m, i) => {
      lines.push(
        `${i + 1}. *${m.job.title}* @ ${m.job.company}`,
        `   📍 ${m.job.location ?? '—'} | 💰 ${m.job.salaryText ?? '—'}`,
        `   Match: ${m.score}%`,
        m.matchFactors.slice(0, 2).join('\n   '),
        m.missingSkills.length ? `   Missing: ✗ ${m.missingSkills.slice(0, 2).join(', ')}` : '',
        '',
      );
    });
    lines.push('Reply GENERATE RESUME or GENERATE COVER LETTER for a role.');
    await this.reply(message, lines.join('\n'));
  }

  private async cmdShowApplications(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const apps = await this.applications.listForProfile(message.userId, profile.id);
    if (apps.length === 0) {
      await this.reply(message, 'No applications yet. Reply VIEW JOBS to find roles.');
      return;
    }

    const lines = ['Your applications:\n'];
    apps.slice(0, 15).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.job.title} @ ${a.job.company} — ${a.status.toUpperCase()}`);
    });
    await this.reply(message, lines.join('\n'));
  }

  private async cmdGenerateResume(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const topMatch = await this.prisma.careerJobMatch.findFirst({
      where: { profileId: profile.id },
      orderBy: { score: 'desc' },
      include: { job: true },
    });
    if (!topMatch?.job) {
      await this.reply(message, 'No job matches yet. Reply FIND JOBS first.');
      return;
    }

    await this.reply(message, `Generating tailored resume for ${topMatch.job.title}…`);

    const content = await this.careerAi.generateTailoredResume(
      message.userId,
      this.profiles.profileSnapshot(profile),
      topMatch.job,
    );
    if (!content) {
      await this.reply(message, 'Could not generate resume. Check AI settings.');
      return;
    }

    const master = profile.masterResumeId
      ? await this.prisma.careerResume.findUnique({ where: { id: profile.masterResumeId } })
      : null;

    const resumeId = master?.id ?? (
      await this.prisma.careerResume.create({
        data: {
          userId: message.userId,
          profileId: profile.id,
          contactId: message.contactId,
          type: 'master',
          isMaster: true,
        },
      })
    ).id;

    const filePath = await this.storage.saveText(
      message.userId,
      'generated',
      `resume_${topMatch.job.id}.txt`,
      content,
    );

    await this.prisma.careerResumeVersion.create({
      data: {
        userId: message.userId,
        resumeId,
        jobId: topMatch.job.id,
        title: `${topMatch.job.title} — tailored`,
        content,
        filePath,
      },
    });

    await this.applications.upsertSaved(
      message.userId,
      profile.id,
      message.contactId,
      topMatch.job.id,
    );

    await this.reply(
      message,
      `Resume generated for *${topMatch.job.title}* at ${topMatch.job.company}! ✅\n\n(Stored in your CareerAI account — PDF export coming in a future update.)`,
    );
  }

  private async cmdGenerateCoverLetter(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const topMatch = await this.prisma.careerJobMatch.findFirst({
      where: { profileId: profile.id },
      orderBy: { score: 'desc' },
      include: { job: true },
    });
    if (!topMatch?.job) {
      await this.reply(message, 'No job matches yet. Reply FIND JOBS first.');
      return;
    }

    const content = await this.careerAi.generateCoverLetter(
      message.userId,
      this.profiles.profileSnapshot(profile),
      topMatch.job,
    );
    if (!content) {
      await this.reply(message, 'Could not generate cover letter.');
      return;
    }

    await this.prisma.careerCoverLetter.create({
      data: {
        userId: message.userId,
        profileId: profile.id,
        jobId: topMatch.job.id,
        content,
      },
    });

    await this.reply(
      message,
      `Cover letter for *${topMatch.job.title}*:\n\n${content.slice(0, 1500)}${content.length > 1500 ? '…' : ''}`,
    );
  }

  private async reply(message: Message & { contact: Contact }, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) {
      return;
    }

    const MAX = 3800;
    if (text.length <= MAX) {
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, text);
      return;
    }

    // Split long messages at paragraph boundaries so WhatsApp never rejects them.
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > MAX) {
      const cut = remaining.lastIndexOf('\n\n', MAX);
      const splitAt = cut > 0 ? cut : MAX;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining.length > 0) chunks.push(remaining);

    for (const chunk of chunks) {
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, chunk);
    }
  }

  // Strips all recognised command prefixes so only the search keyword remains.
  private extractJobKeyword(text: string): string {
    return text
      .replace(/^(find\s+jobs?|search\s+jobs?|job\s+search|view\s+jobs?|top\s+jobs?|daily\s+jobs?)/i, '')
      .trim();
  }

  private matchesCommand(text: string, phrases: readonly string[]): boolean {
    return phrases.some((p) => text === p || text.includes(p));
  }

  private helpText(): string {
    return [
      '*Commands:*',
      '• FIND JOBS {keyword}',
      '• VIEW JOBS',
      '• SHOW APPLICATIONS',
      '• GENERATE RESUME',
      '• GENERATE COVER LETTER',
      '• IMPROVE RESUME',
      '• CAREER ADVICE {question}',
      '• PREPARE INTERVIEW',
    ].join('\n');
  }
}
