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
import { CareerAiService, ConvTurn } from './career-ai.service';
import { CareerResumeParserService } from './career-resume-parser.service';
import { CareerStorageService } from './career-storage.service';
import { CareerApplicationService } from './career-application.service';
import { CareerProfile } from '@prisma/client';

// WhatsApp rejects messages over 4096 chars. We use 3800 to leave a safe buffer.
const WA_MAX_CHARS = 3800;

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
      // Extract the section name the user mentioned after "improve resume".
      const section = lower
        .replace(/improve\s+resume/i, '')
        .trim() || 'experience';
      const suggestion = await this.careerAi.improveResume(
        message.userId,
        section,
        this.profiles.profileSnapshot(profile),
      );
      await this.reply(message, suggestion);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.CAREER_ADVICE)) {
      const history = await this.loadHistory(profile.id);
      const advice = await this.careerAi.careerAdvice(
        message.userId,
        text,
        this.profiles.profileSnapshot(profile),
        history,
      );
      await this.reply(message, advice);
      await this.appendHistory(profile.id, text, advice);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.PREPARE_INTERVIEW)) {
      // Use the first preferred role if set; otherwise fall back to the first
      // word of the user's message after the command (e.g. "prepare interview manager").
      const roles = profile.preferredRoles as string[] | null;
      const role =
        roles?.[0] ??
        lower.replace(/prepare\s+interview|interview\s+prep|interview\s+tips/i, '').trim() ||
        'professional';
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

    await this.reply(message, `Hi! I'm CareerAI 🎯\n\n${this.helpText()}`);
    return true;
  }

  // ─── Onboarding ──────────────────────────────────────────────────────────────

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

    // FIX 3: parsing_resume had no handler — user was permanently stuck receiving
    // "Processing your profile…" forever. Recover by advancing to the first question.
    if (profile.onboardingStep === 'parsing_resume') {
      await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
      await this.reply(
        message,
        "Let's continue setting up your profile.\n\nWhat is your current city/location? (e.g. Mumbai, Pune)",
      );
      return;
    }

    // FIX 2: The original steps map had questions and fields swapped.
    // follow_up_location was asking "preferred location" but saving to currentLocation.
    // follow_up_preferred_location was asking "current salary" but saving to preferredLocations.
    // Both are now corrected so every question exactly matches the field it writes.
    const steps: Record<string, { next: string; field: keyof CareerProfile; question: string }> = {
      follow_up_location: {
        next: 'follow_up_preferred_location',
        field: 'currentLocation',
        question: 'What is your current city/location? (e.g. Mumbai, Pune)',
      },
      follow_up_preferred_location: {
        next: 'follow_up_current_salary',
        field: 'preferredLocations',
        question: 'Where would you prefer to work? (city or "Remote", comma-separated for multiple)',
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

    // FIX 4: The original fallback just said "Processing your profile…" with no
    // state change, permanently trapping the user. Now we log it and recover.
    if (!step) {
      this.logger.warn(
        `Unknown onboarding step "${profile.onboardingStep}" for profile ${profile.id} — recovering`,
      );
      await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
      await this.reply(message, "Let's continue. What is your current city/location?");
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

  // ─── Resume document upload ──────────────────────────────────────────────────

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

    const downloaded = await this.whatsAppApi.downloadMedia(creds.accessToken ?? '', mediaId);
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

    // FIX 6: Every upload previously created a new row with isMaster: true without
    // clearing the previous master, leaving multiple rows all claiming to be master.
    // Clear the flag on all existing resumes for this profile before creating the new one.
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
        `Resume parsed! ✅\n\nHi ${updated.fullName ?? 'there'}, I extracted your skills and experience.\n\nWhat is your current city/location?`,
      );
      return;
    }

    // AI parse failed or text was empty — advance to follow_up_location so the
    // user can proceed through manual questions instead of getting stuck.
    await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
    await this.reply(
      message,
      'Resume saved. I could not auto-parse all fields.\n\nWhat is your current city/location?',
    );
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  private async cmdFindJobs(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
  ): Promise<void> {
    let jobList = await this.jobs.listActive(message.userId);

    // FIX 5: The original regex only stripped "find jobs" / "find job", so alternate
    // command phrases like "search jobs react" or "view jobs python" left the full
    // command phrase in the keyword, producing zero or wrong results.
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
      `Cover letter for *${topMatch.job.title}*:\n\n${content}`,
    );
  }

  // ─── Conversation history helpers ───────────────────────────────────────────

  /**
   * Loads the last 20 conversation turns (10 exchanges) stored on the profile.
   * Returns an empty array when no history exists yet.
   */
  private async loadHistory(profileId: number): Promise<ConvTurn[]> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    const data = profile?.onboardingData as Record<string, unknown> | null;
    const history = data?.conversation_history;
    return Array.isArray(history) ? (history as ConvTurn[]) : [];
  }

  /**
   * Appends one user + assistant turn to the history stored in onboardingData.
   * Keeps the last 20 turns (10 exchanges) to limit DB column growth.
   */
  private async appendHistory(
    profileId: number,
    userMsg: string,
    botMsg: string,
  ): Promise<void> {
    const existing = await this.loadHistory(profileId);
    const updated: ConvTurn[] = [
      ...existing,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: botMsg },
    ].slice(-20);

    // History is stored inside the existing onboardingData JSON column to avoid
    // a schema migration. We merge it with whatever is already in that column.
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    const existing_data = (profile?.onboardingData as Record<string, unknown>) ?? {};

    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        onboardingData: { ...existing_data, conversation_history: updated } as any,
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * FIX 7: WhatsApp silently fails on messages over 4096 characters.
   * The original reply() sent the full string regardless of length.
   * This version splits at paragraph boundaries and sends multiple messages.
   */
  private async reply(message: Message & { contact: Contact }, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) return;

    if (text.length <= WA_MAX_CHARS) {
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, text);
      return;
    }

    // Split at double-newline paragraph boundaries where possible.
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > WA_MAX_CHARS) {
      const cut = remaining.lastIndexOf('\n\n', WA_MAX_CHARS);
      const splitAt = cut > 0 ? cut : WA_MAX_CHARS;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining.length > 0) chunks.push(remaining);

    for (const chunk of chunks) {
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, chunk);
    }
  }

  /**
   * FIX 5: Strips all recognised command prefixes from the user's text so only
   * the search keyword remains. The original regex only handled "find jobs" /
   * "find job", leaving "search jobs react" with "search jobs" still in the keyword.
   */
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
