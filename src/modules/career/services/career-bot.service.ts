import { Injectable, Logger } from '@nestjs/common';
import { Contact, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { InboxService } from '../../inbox/inbox.service';
import { CAREER_COMMANDS, CAREER_MAX_INBOUND_CHARS, CAREER_BOT_MESSAGE_SOURCE } from '../career.constants';
import { CareerProfileService } from './career-profile.service';
import { CareerJobService } from './career-job.service';
import { CareerMatchingService, JobMatchResult } from './career-matching.service';
import { CareerAiService, ConvTurn } from './career-ai.service';
import { CareerResumeParserService } from './career-resume-parser.service';
import { CareerStorageService } from './career-storage.service';
import { CareerApplicationService } from './career-application.service';
import { CareerProfile } from '@prisma/client';

// WhatsApp rejects messages over 4096 chars. We use 3800 to leave a safe buffer.
const WA_MAX_CHARS = 3800;

interface JobSession {
  jobIds: number[];
  listedAt: string;
}

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

    if (isDocument && this.shouldAcceptResumeUpload(profile)) {
      await this.handleResumeDocument(message, profile);
      return true;
    }

    const text = this.sanitizeUserText(String(message.content));
    const lower = text.toLowerCase();

    // ── Digest opt-out / opt-in (checked before onboarding so users can always
    //    unsubscribe even before their profile is complete) ──────────────────────
    if (this.matchesCommand(lower, CAREER_COMMANDS.STOP_DIGEST)) {
      await this.prisma.careerProfile.update({
        where: { id: profile.id },
        data: { digestOptOut: true },
      });
      await this.reply(
        message,
        'You have unsubscribed from daily job digests. ✅\n\nReply *START DIGEST* anytime to re-enable.',
      );
      return true;
    }

    if (lower === 'start digest' || lower === 'subscribe digest') {
      await this.prisma.careerProfile.update({
        where: { id: profile.id },
        data: { digestOptOut: false },
      });
      await this.reply(
        message,
        'Daily job digests re-enabled! 🔔 You will receive matching jobs every morning.',
      );
      return true;
    }

    if (!profile.isComplete) {
      await this.handleOnboarding(message, profile, text);
      return true;
    }

    if (this.matchesCommand(lower, CAREER_COMMANDS.UPLOAD_RESUME)) {
      await this.setReuploadPending(profile.id, true);
      await this.reply(
        message,
        'Please upload your updated resume as a *PDF* or *DOCX* attachment.',
      );
      return true;
    }

    const applyIndex = this.parseApplyIndex(lower);
    if (applyIndex !== null) {
      await this.cmdApply(message, profile, applyIndex);
      return true;
    }

    const resumeIndex = this.parseResumeIndex(lower);
    if (resumeIndex !== null) {
      await this.cmdGenerateResume(message, profile, resumeIndex);
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
      const suggestion = await this.safeAiCall(
        message.userId,
        () =>
          this.careerAi.improveResume(
            message.userId,
            section,
            this.profiles.profileSnapshot(profile),
          ),
        'Could not generate suggestions right now. Please try again.',
        'improve_resume',
      );
      await this.reply(message, suggestion);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.CAREER_ADVICE)) {
      const history = await this.loadHistory(profile.id);
      const advice = await this.safeAiCall(
        message.userId,
        () =>
          this.careerAi.careerAdvice(
            message.userId,
            text,
            this.profiles.profileSnapshot(profile),
            history,
          ),
        'I could not generate advice right now. Please try again in a moment.',
        'career_advice',
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
        (lower.replace(/prepare\s+interview|interview\s+prep|interview\s+tips/i, '').trim() ||
          'professional');
      const prep = await this.safeAiCall(
        message.userId,
        () =>
          this.careerAi.interviewPrep(
            message.userId,
            role,
            this.profiles.profileSnapshot(profile),
          ),
        'Interview prep is unavailable right now. Please try again later.',
        'interview_prep',
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

    if (lower.startsWith('find ') || /^search\s+jobs?\s+/i.test(lower)) {
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
        question:
          'What roles are you targeting? (comma-separated, e.g. React Developer, Full Stack Engineer)',
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

    // PHASE 5 FIX 1: Skip questions whose answers were already extracted from the resume.
    // If the profile field is already populated, silently advance to the next step
    // and recurse so the next question (if also filled) is also skipped automatically.
    if (this.isFieldAlreadyFilled(profile, step.field)) {
      const advanced = await this.profiles.updateOnboarding(profile.id, step.next, {});
      if (step.next === 'complete') {
        await this.finishOnboarding(message, advanced);
        return;
      }
      // Recurse with the updated profile to check the next step too.
      await this.handleOnboarding(message, advanced, text);
      return;
    }

    // PHASE 5 FIX 2: Validate the user's answer before saving.
    const validationError = this.validateOnboardingAnswer(profile.onboardingStep, text);
    if (validationError) {
      await this.reply(message, validationError);
      return; // Re-ask the same question by not advancing the step.
    }

    const data: Prisma.CareerProfileUpdateInput = {};
    if (step.field === 'preferredLocations' || step.field === 'preferredRoles') {
      data[step.field] = text.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      data[step.field] = text;
    }

    const updated = await this.profiles.updateOnboarding(profile.id, step.next, data);

    if (step.next === 'complete') {
      await this.finishOnboarding(message, updated);
      return;
    }

    const nextStep = steps[step.next];
    if (nextStep?.question) {
      await this.reply(message, nextStep.question);
    }
  }

  /** Marks onboarding complete, runs initial job matching, and sends the welcome summary. */
  private async finishOnboarding(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    await this.profiles.markComplete(profile.id);
    const jobList = await this.jobs.listActive(message.userId);
    const matches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      message.userId,
      profile.id,
      message.contactId,
      matches,
    );
    await this.reply(
      message,
      `Your Career Profile is ready! ✅\n\nI found ${matches.length} matching jobs.\n\nReply *VIEW JOBS* to see them, or *FIND JOBS react* to search.\n${this.helpText()}`,
    );
  }

  // ─── Resume document upload ──────────────────────────────────────────────────

  private async handleResumeDocument(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const reupload = await this.isReuploadPending(profile.id);

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

    const { text: extracted, error: extractError } = await this.resumeParser.extractText(
      downloaded.buffer,
      mime,
      fileName,
    );

    if (extractError === 'too_large') {
      await this.reply(
        message,
        'That file is too large (max 10 MB). Please upload a smaller *PDF* or *DOCX* resume.',
      );
      return;
    }

    if (extractError === 'unsupported_format') {
      await this.reply(
        message,
        'That file format is not supported. Please upload your resume as a *PDF* or *DOCX* attachment.',
      );
      return;
    }

    const filePath = await this.storage.saveBuffer(
      message.userId,
      'resumes',
      fileName,
      downloaded.buffer,
    );

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
      data: {
        masterResumeId: resume.id,
        ...(reupload && profile.isComplete ? {} : { onboardingStep: 'parsing_resume' }),
      },
    });

    const parsed = extracted
      ? await this.safeAiCall(
          message.userId,
          () => this.careerAi.parseResume(message.userId, extracted),
          null,
          'parse_resume',
        )
      : null;

    if (reupload && profile.isComplete) {
      await this.clearReuploadPending(profile.id);
      if (parsed) {
        await this.profiles.applyParsedResume(profile.id, parsed);
        await this.reply(
          message,
          'Resume updated! ✅ Your skills and experience have been refreshed from the new file.',
        );
      } else {
        await this.reply(
          message,
          'Resume saved, but I could not auto-parse it. Please try a text-based PDF or DOCX.',
        );
      }
      return;
    }

    if (parsed) {
      const updated = await this.profiles.applyParsedResume(profile.id, parsed);
      await this.profiles.updateOnboarding(profile.id, 'follow_up_location', {});
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

    const top = matches.slice(0, 10);
    await this.saveJobSession(profile.id, top.map((m) => m.job.id));

    const lines = [`Found ${matches.length} matching jobs:\n`];
    top.forEach((m, i) => {
      lines.push(...this.formatJobListing(m, i));
    });
    lines.push(
      '',
      'Reply *APPLY 1* to save & get apply link, or *RESUME 2* to tailor your CV for job #2.',
    );
    await this.reply(message, lines.join('\n'));
  }

  private formatJobListing(m: JobMatchResult, index: number): string[] {
    const lines = [
      `${index + 1}. *${m.job.title}* @ ${m.job.company}`,
      `   📍 ${m.job.location ?? '—'} | 💰 ${m.job.salaryText ?? '—'}`,
      `   Match: ${m.score}%`,
    ];
    if (m.matchFactors.length > 0) {
      lines.push(`   ${m.matchFactors.slice(0, 2).join('\n   ')}`);
    }
    if (m.missingSkills.length > 0) {
      lines.push(`   Missing: ✗ ${m.missingSkills.slice(0, 2).join(', ')}`);
    }
    if (m.job.applyUrl) {
      lines.push(`   🔗 ${m.job.applyUrl}`);
    }
    lines.push('');
    return lines;
  }

  private async cmdApply(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    index1Based: number,
  ): Promise<void> {
    const job = await this.resolveJobByIndex(profile, message.userId, index1Based);
    if (!job) {
      await this.reply(
        message,
        `Job #${index1Based} not found. Reply *VIEW JOBS* or *FIND JOBS* first to refresh the list.`,
      );
      return;
    }

    await this.applications.markApplied(
      message.userId,
      profile.id,
      message.contactId,
      job.id,
    );

    const lines = [
      `*${job.title}* @ ${job.company} — saved as applied ✅`,
      `📍 ${job.location ?? '—'} | 💰 ${job.salaryText ?? '—'}`,
    ];
    if (job.applyUrl) {
      lines.push('', `Apply here:\n${job.applyUrl}`);
    } else {
      lines.push('', 'Search the company career page to submit your application.');
    }
    lines.push('', `Reply *RESUME ${index1Based}* to generate a tailored CV for this role.`);
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
    index1Based?: number,
  ): Promise<void> {
    let job = index1Based
      ? await this.resolveJobByIndex(profile, message.userId, index1Based)
      : await this.resolveJobByIndex(profile, message.userId, 1);

    if (!job) {
      const topMatch = await this.prisma.careerJobMatch.findFirst({
        where: { profileId: profile.id },
        orderBy: { score: 'desc' },
        include: { job: true },
      });
      job = topMatch?.job ?? null;
    }

    if (!job) {
      await this.reply(message, 'No job matches yet. Reply *FIND JOBS* or *VIEW JOBS* first.');
      return;
    }

    const jobNum = index1Based ?? (await this.jobIndexInSession(profile.id, job.id)) ?? 1;

    await this.reply(message, `Generating tailored resume for *${job.title}* @ ${job.company}… ⏳`);

    const content = await this.safeAiCall(
      message.userId,
      () =>
        this.careerAi.generateTailoredResume(
          message.userId,
          this.profiles.profileSnapshot(profile),
          job!,
        ),
      null,
      'generate_resume',
    );
    if (!content) {
      await this.reply(message, 'Could not generate resume. Check AI settings in your portal.');
      return;
    }

    const master = profile.masterResumeId
      ? await this.prisma.careerResume.findUnique({ where: { id: profile.masterResumeId } })
      : null;

    const resumeId =
      master?.id ??
      (
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
      `resume_${job.id}.txt`,
      content,
    );

    await this.prisma.careerResumeVersion.create({
      data: {
        userId: message.userId,
        resumeId,
        jobId: job.id,
        title: `${job.title} — tailored`,
        content,
        filePath,
      },
    });

    await this.applications.upsertSaved(
      message.userId,
      profile.id,
      message.contactId,
      job.id,
    );

    await this.reply(
      message,
      `*Tailored resume — ${job.title} @ ${job.company}*\n\n${content}`,
    );
    await this.reply(
      message,
      `Saved to your CareerAI account ✅\n\nReply *APPLY ${jobNum}* for the apply link, or *GENERATE COVER LETTER* for a cover letter.`,
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

    const content = await this.safeAiCall(
      message.userId,
      () =>
        this.careerAi.generateCoverLetter(
          message.userId,
          this.profiles.profileSnapshot(profile),
          topMatch.job,
        ),
      null,
      'generate_cover_letter',
    );
    if (!content) {
      await this.reply(message, 'Could not generate cover letter. Check AI settings in your portal.');
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
      { role: 'user' as const, content: userMsg },
      { role: 'assistant' as const, content: botMsg },
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
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, text, {
        source: CAREER_BOT_MESSAGE_SOURCE,
      });
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
      await this.inbox.sendOutgoingMessage(message.userId, conversation.id, chunk, {
        source: CAREER_BOT_MESSAGE_SOURCE,
      });
    }
  }

  /**
   * Returns true when the profile field that `step` would collect is already
   * populated — meaning it was extracted from the resume and the question can
   * be skipped without asking the user again.
   */
  private isFieldAlreadyFilled(
    profile: CareerProfile,
    field: keyof CareerProfile,
  ): boolean {
    const val = profile[field];
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    return true;
  }

  /**
   * Returns a user-facing error string when the answer fails basic validation,
   * or null when the answer is acceptable.
   * Only the fields where garbage input causes real downstream damage are checked.
   */
  private validateOnboardingAnswer(step: string, text: string): string | null {
    const t = text.trim();
    if (!t) return 'Please type a valid answer.';

    if (step === 'follow_up_current_salary' || step === 'follow_up_expected_salary') {
      const hasNumber    = /\d/.test(t);
      const isNegotiable = /negotiable|open|discuss|fresher|no salary|nil/i.test(t);
      if (!hasNumber && !isNegotiable) {
        return 'Please enter a salary like *12 LPA*, *12-15 LPA*, or type *Negotiable* / *Fresher*.';
      }
    }

    if (step === 'follow_up_notice_period') {
      const valid = /\d|immediate|no\s*notice|zero|serving|n\/a|none/i.test(t);
      if (!valid) {
        return 'Please enter your notice period like *30 days*, *2 months*, or *Immediate*.';
      }
    }

    if (step === 'follow_up_job_type') {
      const valid = /remote|hybrid|onsite|on.?site|office|anywhere|wfh|work from home/i.test(t);
      if (!valid) {
        return 'Please reply *Remote*, *Hybrid*, or *Onsite*.';
      }
    }

    if (step === 'follow_up_roles') {
      if (t.length < 2) {
        return 'Please enter at least one target role (e.g. *React Developer*).';
      }
    }

    return null;
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

  /** Strips control characters and caps length before onboarding / command handling. */
  private sanitizeUserText(raw: string): string {
    return raw
      .replace(/\0/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, CAREER_MAX_INBOUND_CHARS);
  }

  /** Catches thrown AI errors; logs context for production debugging. */
  private async safeAiCall<T>(
    userId: number,
    fn: () => Promise<T>,
    fallback: T,
    context: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      this.logger.error(`AI call failed [${context}] user=${userId}: ${e.message}`);
      return fallback;
    }
  }

  private helpText(): string {
    return [
      '*Commands:*',
      '• VIEW JOBS / FIND JOBS {keyword}',
      '• APPLY 1 — save job & get apply link',
      '• RESUME 2 — tailor CV for job #2',
      '• GENERATE COVER LETTER',
      '• UPLOAD RESUME — update your CV',
      '• SHOW APPLICATIONS',
      '• CAREER ADVICE {question}',
      '• PREPARE INTERVIEW',
      '• STOP DIGEST / START DIGEST',
    ].join('\n');
  }

  private shouldAcceptResumeUpload(profile: CareerProfile): boolean {
    if (['welcome', 'awaiting_resume'].includes(profile.onboardingStep)) {
      return true;
    }
    const data = profile.onboardingData as Record<string, unknown> | null;
    return data?.reupload_pending === true;
  }

  private async isReuploadPending(profileId: number): Promise<boolean> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    const data = profile?.onboardingData as Record<string, unknown> | null;
    return data?.reupload_pending === true;
  }

  private async setReuploadPending(profileId: number, pending: boolean): Promise<void> {
    await this.mergeOnboardingData(profileId, { reupload_pending: pending });
  }

  private async clearReuploadPending(profileId: number): Promise<void> {
    await this.mergeOnboardingData(profileId, { reupload_pending: false });
  }

  private async mergeOnboardingData(
    profileId: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    const existing = (profile?.onboardingData as Record<string, unknown>) ?? {};
    await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: { onboardingData: { ...existing, ...patch } as any },
    });
  }

  private async saveJobSession(profileId: number, jobIds: number[]): Promise<void> {
    const session: JobSession = { jobIds, listedAt: new Date().toISOString() };
    await this.mergeOnboardingData(profileId, { job_session: session });
  }

  private async loadJobSession(profileId: number): Promise<JobSession | null> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { id: profileId },
      select: { onboardingData: true },
    });
    const data = profile?.onboardingData as Record<string, unknown> | null;
    const session = data?.job_session as JobSession | undefined;
    if (!session?.jobIds?.length) {
      return null;
    }
    return session;
  }

  private async resolveJobByIndex(
    profile: CareerProfile,
    userId: number,
    index1Based: number,
  ) {
    if (index1Based < 1) {
      return null;
    }

    const session = await this.loadJobSession(profile.id);
    if (session && session.jobIds[index1Based - 1]) {
      return this.prisma.careerJob.findFirst({
        where: {
          id: session.jobIds[index1Based - 1],
          userId,
          isActive: true,
        },
      });
    }

    const matches = await this.prisma.careerJobMatch.findMany({
      where: { profileId: profile.id, userId },
      orderBy: { score: 'desc' },
      take: 10,
      include: { job: true },
    });
    return matches[index1Based - 1]?.job ?? null;
  }

  private async jobIndexInSession(profileId: number, jobId: number): Promise<number | null> {
    const session = await this.loadJobSession(profileId);
    if (!session) {
      return null;
    }
    const idx = session.jobIds.indexOf(jobId);
    return idx >= 0 ? idx + 1 : null;
  }

  private parseApplyIndex(lower: string): number | null {
    const match = lower.match(/^apply\s*#?\s*(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
  }

  private parseResumeIndex(lower: string): number | null {
    const match = lower.match(/^(?:generate\s+)?resume\s*#?\s*(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
  }
}
