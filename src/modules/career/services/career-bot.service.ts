import { Injectable, Logger, Inject } from '@nestjs/common';
import { Contact, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { InboxService } from '../../inbox/inbox.service';
import { CAREER_COMMANDS, CAREER_MAX_INBOUND_CHARS, CAREER_BOT_MESSAGE_SOURCE, CAREER_WORK_MODE_BUTTONS, buildJobActionButtons } from '../career.constants';
import { CareerProfileService } from './career-profile.service';
import { CareerJobService } from './career-job.service';
import { CareerMatchingService, JobMatchResult, CAREER_MIN_MATCH_SCORE } from './career-matching.service';
import { CareerAiService, ConvTurn, ParsedCareerProfile } from './career-ai.service';
import { CareerResumeParserService } from './career-resume-parser.service';
import { CareerStorageService } from './career-storage.service';
import { CareerApplicationService } from './career-application.service';
import { CareerPrivacyService } from './career-privacy.service';
import { CareerDocumentShareService } from './career-document-share.service';
import { CareerDocxService } from './career-docx.service';
import { CareerResumeBuilderService } from './career-resume-builder.service';
import {
  careerDocxFileName,
  DOCX_MIME,
  readCareerDocumentBuffer,
} from '../career-document.util';
import { CareerProfile } from '@prisma/client';
import { JOB_DISPATCHER, JobDispatcher } from '../../queue/job-dispatcher';

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
    private readonly privacy: CareerPrivacyService,
    private readonly share: CareerDocumentShareService,
    private readonly docx: CareerDocxService,
    private readonly resumeBuilder: CareerResumeBuilderService,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  async handleIncomingMessage(message: Message & { contact: Contact }): Promise<boolean> {
    const raw = (message.metadata as { raw?: Record<string, unknown> })?.raw;
    const msgType = raw ? String((raw as { type?: string }).type ?? '') : '';

    const profile = await this.profiles.getOrCreate(message.userId, message.contact);
    await this.jobs.ensureSampleJobs(message.userId);

    const isResumeMedia =
      (msgType === 'document' || msgType === 'image') && this.shouldAcceptResumeUpload(profile);

    if (isResumeMedia) {
      await this.handleResumeMedia(message, profile);
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

    if (this.matchesCommand(lower, CAREER_COMMANDS.RESET_PROFILE)) {
      await this.cmdResetProfile(message, profile);
      return true;
    }

    if (this.matchesCommand(lower, CAREER_COMMANDS.DELETE_MY_DATA)) {
      await this.cmdDeleteMyData(message, profile);
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
        'Please upload your updated resume as a *PDF*, *DOCX*, or a clear *photo* (JPEG/PNG).',
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

    const coverIndex = this.parseCoverLetterIndex(lower);
    if (coverIndex !== null || this.matchesCommand(lower, CAREER_COMMANDS.GENERATE_COVER_LETTER)) {
      await this.cmdGenerateCoverLetter(message, profile, coverIndex ?? undefined);
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
    if (this.matchesCommand(lower, CAREER_COMMANDS.SALARY_BENCHMARK)) {
      const benchmark = await this.safeAiCall(
        message.userId,
        () =>
          this.careerAi.salaryBenchmark(message.userId, this.profiles.profileSnapshot(profile)),
        'Salary benchmark unavailable right now. Try again later.',
        'salary_benchmark',
      );
      await this.reply(message, benchmark);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.SCHEDULE_INTERVIEW)) {
      await this.cmdScheduleInterview(message, profile, text);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.ENABLE_AUTO_APPLY)) {
      await this.cmdSetAutoApply(message, profile, true);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.DISABLE_AUTO_APPLY)) {
      await this.cmdSetAutoApply(message, profile, false);
      return true;
    }
    if (this.matchesCommand(lower, CAREER_COMMANDS.AUTO_APPLY_STATUS)) {
      await this.cmdAutoApplyStatus(message, profile);
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
    const steps = this.getOnboardingSteps();

    // Skip questions already answered from resume AI parse — then prompt the next empty step.
    let current = profile;
    let currentStepKey = profile.onboardingStep;
    while (true) {
      const currentStep = steps[currentStepKey];
      if (!currentStep) {
        break;
      }
      if (!this.isFieldAlreadyFilled(current, currentStep.field)) {
        break;
      }
      current = await this.profiles.updateOnboarding(current.id, currentStep.next, {});
      if (currentStep.next === 'complete') {
        await this.finishOnboarding(message, current);
        return;
      }
      currentStepKey = currentStep.next;
    }

    const step = steps[current.onboardingStep];
    if (!step) {
      this.logger.warn(
        `Unknown onboarding step "${current.onboardingStep}" for profile ${current.id} — recovering`,
      );
      await this.profiles.updateOnboarding(current.id, 'follow_up_location', {});
      await this.reply(message, "Let's continue. What is your current city/location?");
      return;
    }

    if (current.onboardingStep !== profile.onboardingStep) {
      await this.promptOnboardingStep(message, current.onboardingStep);
      return;
    }

    // PHASE 5 FIX 2: Validate the user's answer before saving.
    const validationError = this.validateOnboardingAnswer(current.onboardingStep, text);
    if (validationError) {
      if (current.onboardingStep === 'follow_up_job_type') {
        await this.replyWorkModePrompt(message, validationError);
      } else {
        await this.reply(message, validationError);
      }
      return;
    }

    const data: Prisma.CareerProfileUpdateInput = {};
    if (step.field === 'preferredLocations' || step.field === 'preferredRoles') {
      data[step.field] = text.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      data[step.field] = text;
    }

    const updated = await this.profiles.updateOnboarding(current.id, step.next, data);

    if (step.next === 'complete') {
      await this.finishOnboarding(message, updated);
      return;
    }

    const nextStep = steps[step.next];
    if (step.next === 'follow_up_job_type') {
      await this.replyWorkModePrompt(message);
    } else if (nextStep?.question) {
      await this.reply(message, nextStep.question);
    }
  }

  /** Marks onboarding complete, runs initial job matching, and shows top jobs immediately. */
  private async finishOnboarding(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    await this.profiles.markComplete(profile.id);
    let jobList = await this.jobs.listActive(message.userId);
    jobList = this.jobs.relevantJobsForProfile(jobList, profile);
    const allMatches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      message.userId,
      profile.id,
      message.contactId,
      allMatches,
    );
    const matches = this.matching.filterQualityMatches(allMatches);
    const intro =
      matches.length > 0
        ? `Your Career Profile is ready! ✅ I found *${matches.length}* strong matches (70%+ fit) for your role, skills, and location.`
        : 'Your Career Profile is ready! ✅';
    if (matches.length === 0) {
      await this.reply(
        message,
        allMatches.length > 0
          ? `${intro}\n\nNo jobs scored 70%+ for your profile yet. Try *FIND JOBS {skill}* or update your location/roles, or ask your operator to fetch more listings.`
          : `${intro}\n\nNo jobs in the system yet. Reply *VIEW JOBS* after your operator fetches listings.`,
      );
      return;
    }
    await this.presentTopJobs(message, profile, matches, intro);
  }

  /** Sends the numbered job list and action buttons to WhatsApp. */
  private async presentTopJobs(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    matches: JobMatchResult[],
    intro: string,
    maxJobs = 5,
  ): Promise<void> {
    if (matches.length === 0) {
      await this.reply(
        message,
        `${intro}\n\nNo jobs in the system yet. Reply *VIEW JOBS* after your operator fetches listings, or *FIND JOBS react* to search.`,
      );
      return;
    }

    const top = matches.slice(0, maxJobs);
    await this.saveJobSession(profile.id, top.map((m) => m.job.id));

    const lines = [`${intro}\n`, `*Top ${top.length} jobs for you:*\n`];
    top.forEach((m, i) => {
      lines.push(...this.formatJobListing(m, i));
    });
    lines.push(
      '',
      'One tap next steps:',
      '• *APPLY 1* — save & get apply link',
      '• *RESUME 1* — tailored DOCX for job #1',
      '• *COVER LETTER 1* — matching cover letter',
      '• *FIND JOBS python* — search more roles',
    );
    await this.reply(message, lines.join('\n'));
    await this.sendJobActionButtons(message, top.length);
  }

  // ─── Resume document upload ──────────────────────────────────────────────────

  private async handleResumeMedia(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const reupload = await this.isReuploadPending(profile.id);

    const raw = (message.metadata as { raw?: any })?.raw;
    const media = this.getResumeMedia(raw);
    if (!media?.id) {
      await this.reply(
        message,
        'Could not read the file. Please upload a *PDF*, *DOCX*, or a clear *photo* of your resume.',
      );
      return;
    }

    await this.reply(message, 'Thanks! Reading your resume… ⏳');

    await this.dispatcher.enqueueCareerTask({
      type: 'parse_resume',
      messageId: message.id,
      profileId: profile.id,
      userId: message.userId,
      reupload,
    });
  }

  /** Background worker: download, parse, and reply for resume uploads. */
  async runParseResumeTask(messageId: number, reupload: boolean): Promise<void> {
    const message = await this.loadIncomingMessage(messageId);
    if (!message) {
      return;
    }
    const profileRecord = await this.prisma.careerProfile.findFirst({
      where: { contactId: message.contactId, userId: message.userId },
    });
    if (!profileRecord) {
      return;
    }
    await this.processResumeUpload(message, profileRecord, reupload);
  }

  private async processResumeUpload(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    reupload: boolean,
  ): Promise<void> {
    const raw = (message.metadata as { raw?: any })?.raw;
    const media = this.getResumeMedia(raw);
    if (!media?.id) {
      await this.reply(
        message,
        'Could not read the file. Please upload a *PDF*, *DOCX*, or a clear *photo* of your resume.',
      );
      return;
    }

    const creds = await this.whatsapp.credentials(message.userId);
    if (!creds?.accessToken) {
      await this.reply(message, 'WhatsApp is not connected. Please contact support.');
      return;
    }

    const downloaded = await this.whatsAppApi.downloadMedia(creds.accessToken ?? '', media.id);
    if (!downloaded.success || !downloaded.buffer) {
      await this.reply(message, 'Failed to download resume. Please try again.');
      return;
    }

    const mime = media.mime ?? 'application/pdf';
    const fileName = media.fileName ?? 'resume.pdf';

    const { text: extracted, error: extractError, ocrUsed } = await this.resumeParser.extractText(
      downloaded.buffer,
      mime,
      fileName,
    );

    if (extractError === 'too_large') {
      await this.reply(
        message,
        'That file is too large (max 10 MB). Please upload a smaller *PDF*, *DOCX*, or image.',
      );
      return;
    }

    if (extractError === 'unsupported_format') {
      await this.reply(
        message,
        'That file format is not supported. Upload *PDF*, *DOCX*, or a clear *JPEG/PNG photo* of your resume.',
      );
      return;
    }

    if (extractError === 'scanned_pdf') {
      await this.reply(
        message,
        'This PDF looks scanned (no readable text). Please send a *clear photo* of each page as JPEG/PNG, or a text-based PDF.',
      );
      return;
    }

    if (extractError === 'ocr_failed') {
      await this.reply(
        message,
        'Could not read text from that image. Try a clearer, well-lit photo of your resume.',
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

    const aiParsed = extracted
      ? await this.safeAiCall(
          message.userId,
          () => this.careerAi.parseResume(message.userId, extracted),
          null,
          'parse_resume',
        )
      : null;
    const basicParsed = extracted ? this.resumeParser.extractBasicFields(extracted) : null;
    const parsed = this.mergeParsedProfile(aiParsed, basicParsed);

    if (reupload && profile.isComplete) {
      await this.clearReuploadPending(profile.id);
      if (parsed) {
        const updated = await this.profiles.applyParsedResumeUpdate(profile.id, parsed);
        let jobList = await this.jobs.listActive(message.userId);
        jobList = this.jobs.relevantJobsForProfile(jobList, updated);
        const allMatches = this.matching.matchProfileToJobs(updated, jobList);
        await this.matching.persistMatches(
          message.userId,
          updated.id,
          message.contactId,
          allMatches,
        );
        const matches = this.matching.filterQualityMatches(allMatches);
        if (matches.length === 0) {
          await this.reply(
            message,
            allMatches.length > 0
              ? 'Resume updated! ✅ No jobs scored 70%+ for your profile yet. Try *FIND JOBS {skill}* or *VIEW JOBS* after more listings are fetched.'
              : 'Resume updated! ✅ No matching jobs in the system yet. Reply *VIEW JOBS* later.',
          );
          return;
        }
        await this.presentTopJobs(
          message,
          updated,
          matches,
          `Resume updated! ✅ I found *${matches.length}* strong matches (70%+ fit).`,
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
      if (updated.onboardingStep === 'complete') {
        await this.finishOnboarding(message, updated);
        return;
      }
      const summary = this.resumeBuilder.formatParsedSummary(updated);
      const intro = `Resume parsed! ✅\n\n${summary}`;
      if (updated.onboardingStep === 'follow_up_job_type') {
        await this.reply(message, `${intro}\n\nOne quick question:`);
        await this.replyWorkModePrompt(message);
        return;
      }
      const question = this.getOnboardingSteps()[updated.onboardingStep]?.question;
      await this.reply(message, question ? `${intro}\n\n${question}` : intro);
      return;
    }

    // AI parse failed — use heuristic fields so onboarding can still continue.
    const fallbackParsed = extracted ? this.resumeParser.extractBasicFields(extracted) : null;
    if (fallbackParsed) {
      const updated = await this.profiles.applyParsedResume(profile.id, fallbackParsed);
      const summary = this.resumeBuilder.formatParsedSummary(updated);
      if (updated.onboardingStep === 'complete') {
        await this.finishOnboarding(message, updated);
        return;
      }
      const question = this.getOnboardingSteps()[updated.onboardingStep]?.question;
      await this.reply(
        message,
        `Resume saved. ✅\n\n${summary}\n\n${question ?? 'What is your current city/location?'}`,
      );
      return;
    }

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

    const keyword = this.extractJobKeyword(text);
    if (keyword && keyword !== 'all' && keyword.length > 1) {
      jobList = this.jobs.searchByKeyword(jobList, keyword);
    } else {
      jobList = this.jobs.relevantJobsForProfile(jobList, profile);
    }

    const allMatches = this.matching.matchProfileToJobs(profile, jobList);
    await this.matching.persistMatches(
      message.userId,
      profile.id,
      message.contactId,
      allMatches,
    );
    const matches = this.matching.filterQualityMatches(allMatches);

    if (matches.length === 0) {
      await this.reply(
        message,
        allMatches.length > 0
          ? `No jobs scored *70%+* for your profile${keyword && keyword !== 'all' ? ` for "${keyword}"` : ''}. Try another keyword, update your profile, or ask your operator to fetch more listings.`
          : 'No matching jobs found. Try *FIND JOBS react* or *FIND JOBS sales*, or ask your operator to fetch live jobs.',
      );
      return;
    }

    const intro = `Found *${matches.length}* jobs with *70%+* match${keyword && keyword !== 'all' ? ` for "${keyword}"` : ''}:`;

    await this.presentTopJobs(message, profile, matches, intro, 8);
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

    const autoApply = profile.autoApplyConsent === true;

    await this.applications.markApplied(
      message.userId,
      profile.id,
      message.contactId,
      job.id,
      autoApply,
    );

    const lines = [
      autoApply
        ? `*${job.title}* @ ${job.company} — queued for assisted apply ✅`
        : `*${job.title}* @ ${job.company} — saved as applied ✅`,
      `📍 ${job.location ?? '—'} | 💰 ${job.salaryText ?? '—'}`,
    ];
    if (autoApply) {
      lines.push(
        '',
        'Your operator will assist with submission using your tailored resume. Reply *DISABLE AUTO APPLY* to opt out.',
      );
    }
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

    await this.dispatcher.enqueueCareerTask({
      type: 'generate_resume',
      messageId: message.id,
      profileId: profile.id,
      userId: message.userId,
      jobIndex: jobNum,
    });
  }

  async runGenerateResumeTask(
    messageId: number,
    profileId: number,
    jobIndex?: number,
  ): Promise<void> {
    const message = await this.loadIncomingMessage(messageId);
    if (!message) {
      return;
    }
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: message.userId },
    });
    if (!profile) {
      return;
    }
    await this.processGenerateResume(message, profile, jobIndex);
  }

  private async processGenerateResume(
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

    const originalResumeText = await this.loadOriginalResumeText(profile);
    if (!originalResumeText.trim()) {
      await this.reply(
        message,
        'Please upload your resume first (*UPLOAD RESUME*) so I can tailor it using your real experience.',
      );
      return;
    }

    const aiContent = await this.safeAiCall(
      message.userId,
      () =>
        this.careerAi.generateTailoredResume(
          message.userId,
          this.profiles.profileSnapshot(profile),
          job!,
          originalResumeText,
        ),
      null,
      'generate_resume',
    );
    const snapshot = this.profiles.profileSnapshot(profile);
    const content = this.resumeBuilder.ensureTailoredResume(
      aiContent,
      snapshot,
      originalResumeText,
      job!,
    );

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

    const docxBuffer = await this.docx.resumeFromText('', content);
    const filePathDocx = await this.storage.saveBuffer(
      message.userId,
      'generated',
      `resume_${job.id}.docx`,
      docxBuffer,
    );

    const version = await this.prisma.careerResumeVersion.create({
      data: {
        userId: message.userId,
        resumeId,
        jobId: job.id,
        title: `${job.title} — tailored`,
        content,
        filePathDocx,
      },
    });

    await this.applications.upsertSaved(
      message.userId,
      profile.id,
      message.contactId,
      job.id,
    );

    const downloadUrl = this.share.buildShareUrl('resume-version', version.id, message.userId);
    const fileName = careerDocxFileName(`${job.title}-${job.company}`);
    const docSent = await this.sendDocumentToContact(
      message.userId,
      message.contactId,
      docxBuffer,
      fileName,
      DOCX_MIME,
      `Tailored resume for ${job.title} @ ${job.company}`,
    );

    if (docSent.success) {
      await this.reply(
        message,
        `*Tailored resume sent* ✅ — ${job.title} @ ${job.company}\n\nBuilt from your uploaded resume, optimised for this role.\n\nReply *APPLY ${jobNum}* for the apply link, or *COVER LETTER ${jobNum}* for a matching cover letter.`,
      );
    } else {
      this.logger.warn(
        `Resume document send failed profileId=${profile.id}: ${docSent.error ?? 'unknown'}`,
      );
      await this.reply(
        message,
        `*Tailored resume ready* — ${job.title} @ ${job.company}\n\n📎 Download DOCX (link valid 72 hours):\n${downloadUrl}`,
      );
    }
  }

  private async cmdGenerateCoverLetter(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    index1Based?: number,
  ): Promise<void> {
    let job = index1Based
      ? await this.resolveJobByIndex(profile, message.userId, index1Based)
      : await this.resolveJobByIndex(profile, message.userId, 1);

    if (!job) {
      const topMatch = await this.prisma.careerJobMatch.findFirst({
        where: { profileId: profile.id, score: { gte: CAREER_MIN_MATCH_SCORE } },
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

    await this.reply(
      message,
      `Generating cover letter for *${job.title}* @ ${job.company}… ⏳`,
    );

    await this.dispatcher.enqueueCareerTask({
      type: 'generate_cover_letter',
      messageId: message.id,
      profileId: profile.id,
      userId: message.userId,
      jobIndex: jobNum,
    });
  }

  async runGenerateCoverLetterTask(
    messageId: number,
    profileId: number,
    jobIndex?: number,
  ): Promise<void> {
    const message = await this.loadIncomingMessage(messageId);
    if (!message) {
      return;
    }
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId: message.userId },
    });
    if (!profile) {
      return;
    }

    let job = jobIndex
      ? await this.resolveJobByIndex(profile, message.userId, jobIndex)
      : await this.resolveJobByIndex(profile, message.userId, 1);

    if (!job) {
      const topMatch = await this.prisma.careerJobMatch.findFirst({
        where: { profileId: profile.id, score: { gte: CAREER_MIN_MATCH_SCORE } },
        orderBy: { score: 'desc' },
        include: { job: true },
      });
      job = topMatch?.job ?? null;
    }

    if (!job) {
      await this.reply(message, 'No job matches yet. Reply *FIND JOBS* first.');
      return;
    }

    const originalResumeText = await this.loadOriginalResumeText(profile);
    if (!originalResumeText.trim()) {
      await this.reply(
        message,
        'Please upload your resume first (*UPLOAD RESUME*) so I can write a cover letter from your real background.',
      );
      return;
    }

    const aiContent = await this.safeAiCall(
      message.userId,
      () =>
        this.careerAi.generateCoverLetter(
          message.userId,
          this.profiles.profileSnapshot(profile),
          job!,
          originalResumeText,
        ),
      null,
      'generate_cover_letter',
    );
    const snapshot = this.profiles.profileSnapshot(profile);
    const content = this.resumeBuilder.ensureCoverLetter(
      aiContent,
      snapshot,
      originalResumeText,
      job!,
    );

    const docTitle = `Cover Letter — ${job.title} @ ${job.company}`;
    const docxBuffer = await this.docx.coverLetterFromText(docTitle, content);
    const filePathDocx = await this.storage.saveBuffer(
      message.userId,
      'generated',
      `cover_letter_${job.id}.docx`,
      docxBuffer,
    );

    const letter = await this.prisma.careerCoverLetter.create({
      data: {
        userId: message.userId,
        profileId: profile.id,
        jobId: job.id,
        content,
        filePath: filePathDocx,
        filePathDocx,
      },
    });

    const jobNum = jobIndex ?? (await this.jobIndexInSession(profile.id, job.id)) ?? 1;
    const downloadUrl = this.share.buildShareUrl('cover-letter', letter.id, message.userId);
    const fileName = careerDocxFileName(`cover-letter-${job.title}-${job.company}`);
    const docSent = await this.sendDocumentToContact(
      message.userId,
      message.contactId,
      docxBuffer,
      fileName,
      DOCX_MIME,
      `Cover letter for ${job.title} @ ${job.company}`,
    );

    if (docSent.success) {
      await this.reply(
        message,
        `*Cover letter sent* ✅ — ${job.title} @ ${job.company}\n\nWritten from your resume.\n\nReply *APPLY ${jobNum}* to save this role and get the apply link.`,
      );
    } else {
      this.logger.warn(
        `Cover letter document send failed profileId=${profile.id}: ${docSent.error ?? 'unknown'}`,
      );
      await this.reply(
        message,
        `*Cover letter ready* — ${job.title} @ ${job.company}\n\n📎 Download DOCX (link valid 72 hours):\n${downloadUrl}`,
      );
    }
  }

  /** Re-run matching for a profile (portal operator action). */
  async rematchProfile(userId: number, profileId: number) {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      return null;
    }

    const jobList = await this.jobs.listActive(userId);
    const relevant = this.jobs.relevantJobsForProfile(jobList, profile);
    const allMatches = this.matching.matchProfileToJobs(profile, relevant);
    await this.matching.persistMatches(userId, profileId, profile.contactId, allMatches);
    const quality = this.matching.filterQualityMatches(allMatches);

    return {
      matchCount: quality.length,
      totalScored: allMatches.length,
      topScore: quality[0]?.score ?? 0,
    };
  }

  /** Send a generated resume to the job seeker on WhatsApp (portal operator action). */
  async sendResumeVersionToContact(
    userId: number,
    versionId: number,
  ): Promise<{ success: boolean; error?: string }> {
    const version = await this.prisma.careerResumeVersion.findFirst({
      where: { id: versionId, userId },
      include: { job: true, resume: true },
    });
    if (!version?.content && !version?.filePathDocx && !version?.filePath) {
      return { success: false, error: 'Resume version not found' };
    }

    const profileId = version.resume?.profileId;
    if (!profileId) {
      return { success: false, error: 'Profile not linked' };
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      return { success: false, error: 'Profile not found' };
    }

    const buffer = await readCareerDocumentBuffer(this.storage, version);
    if (!buffer) {
      return { success: false, error: 'Resume file unavailable' };
    }

    const fileName = careerDocxFileName(
      version.job ? `${version.job.title}-${version.job.company}` : version.title ?? 'resume',
    );
    const caption = version.job
      ? `Tailored resume — ${version.job.title} @ ${version.job.company}`
      : 'Tailored resume';

    const docSent = await this.sendDocumentToContact(
      userId,
      profile.contactId,
      buffer,
      fileName,
      DOCX_MIME,
      caption,
    );

    if (docSent.success) {
      return { success: true };
    }

    const downloadUrl = this.share.buildShareUrl('resume-version', version.id, userId);
    return this.sendTextToProfile(
      userId,
      profileId,
      `${caption}\n\nDocument attach failed — download here (72h):\n${downloadUrl}`,
    );
  }

  /** Send a cover letter to the job seeker on WhatsApp (portal operator action). */
  async sendCoverLetterToContact(
    userId: number,
    coverLetterId: number,
  ): Promise<{ success: boolean; error?: string }> {
    const letter = await this.prisma.careerCoverLetter.findFirst({
      where: { id: coverLetterId, userId },
      include: { job: true },
    });
    if (!letter?.content && !letter?.filePathDocx && !letter?.filePath) {
      return { success: false, error: 'Cover letter not found' };
    }

    const buffer = await readCareerDocumentBuffer(this.storage, letter);
    if (!buffer) {
      return { success: false, error: 'Cover letter file unavailable' };
    }

    const fileName = careerDocxFileName(
      letter.job
        ? `cover-letter-${letter.job.title}-${letter.job.company}`
        : `cover-letter-${letter.id}`,
    );
    const caption = letter.job
      ? `Cover letter — ${letter.job.title} @ ${letter.job.company}`
      : 'Cover letter';

    const docSent = await this.sendDocumentToContact(
      userId,
      letter.profileId,
      buffer,
      fileName,
      DOCX_MIME,
      caption,
    );

    if (docSent.success) {
      return { success: true };
    }

    const downloadUrl = this.share.buildShareUrl('cover-letter', letter.id, userId);
    return this.sendTextToProfile(
      userId,
      letter.profileId,
      `${caption}\n\nDocument attach failed — download here (72h):\n${downloadUrl}`,
    );
  }

  async notifyCareerTaskFailure(messageId: number, taskLabel: string): Promise<void> {
    const message = await this.loadIncomingMessage(messageId);
    if (!message) {
      return;
    }
    await this.reply(
      message,
      `Sorry, ${taskLabel} failed. Please try again in a moment. If it keeps failing, check AI settings in your portal or contact support.`,
    );
  }

  private async sendDocumentToContact(
    userId: number,
    contactId: number,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId },
    });
    if (!conversation) {
      return { success: false, error: 'No WhatsApp conversation for this contact' };
    }

    const result = await this.inbox.sendOutgoingDocument(
      userId,
      conversation.id,
      buffer,
      fileName,
      mimeType,
      caption,
      { source: CAREER_BOT_MESSAGE_SOURCE },
    );

    if (!result.success) {
      this.logger.warn(
        `sendOutgoingDocument failed contactId=${contactId} file=${fileName}: ${result.error}`,
      );
    }

    return {
      success: result.success,
      error: result.error ?? undefined,
    };
  }

  private async sendTextToProfile(
    userId: number,
    profileId: number,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      return { success: false, error: 'Profile not found' };
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: profile.contactId },
    });
    if (!conversation) {
      return { success: false, error: 'No WhatsApp conversation for this contact' };
    }

    const sent = await this.sendChunkedText(userId, conversation.id, text);
    if (!sent) {
      return {
        success: false,
        error: 'WhatsApp delivery failed — check connection and 24-hour messaging window',
      };
    }
    return { success: true };
  }

  private async loadOriginalResumeText(profile: CareerProfile): Promise<string> {
    const resume = profile.masterResumeId
      ? await this.prisma.careerResume.findUnique({ where: { id: profile.masterResumeId } })
      : await this.prisma.careerResume.findFirst({
          where: { profileId: profile.id, isMaster: true },
          orderBy: { createdAt: 'desc' },
        });

    if (resume?.extractedText?.trim()) {
      return resume.extractedText.trim();
    }

    const fallback = await this.prisma.careerResume.findFirst({
      where: { profileId: profile.id, extractedText: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    return fallback?.extractedText?.trim() ?? '';
  }

  private async loadIncomingMessage(
    messageId: number,
  ): Promise<(Message & { contact: Contact }) | null> {
    return this.prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });
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
  private async reply(message: Message & { contact: Contact }, text: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) {
      this.logger.warn(`No conversation for contactId=${message.contactId} — message not sent`);
      return false;
    }

    const sent = await this.sendChunkedText(message.userId, conversation.id, text);
    if (!sent) {
      this.logger.warn(`WhatsApp reply failed for contactId=${message.contactId}`);
    }
    return sent;
  }

  private async sendChunkedText(
    userId: number,
    conversationId: number,
    text: string,
  ): Promise<boolean> {
    const chunks: string[] = [];
    if (text.length <= WA_MAX_CHARS) {
      chunks.push(text);
    } else {
      let remaining = text;
      while (remaining.length > WA_MAX_CHARS) {
        const cut = remaining.lastIndexOf('\n\n', WA_MAX_CHARS);
        const splitAt = cut > 0 ? cut : WA_MAX_CHARS;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
      }
      if (remaining.length > 0) {
        chunks.push(remaining);
      }
    }

    let allOk = true;
    for (const chunk of chunks) {
      const result = await this.inbox.sendOutgoingMessage(userId, conversationId, chunk, {
        source: CAREER_BOT_MESSAGE_SOURCE,
      });
      if (!result.success) {
        allOk = false;
        this.logger.warn(`WhatsApp chunk failed conversationId=${conversationId}: ${result.error}`);
      }
    }
    return allOk;
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

  private mergeParsedProfile(
    ai: ParsedCareerProfile | null,
    basic: ParsedCareerProfile | null,
  ): ParsedCareerProfile | null {
    if (!ai && !basic) {
      return null;
    }
    if (!ai) {
      return basic;
    }
    if (!basic) {
      return ai;
    }
    return {
      ...basic,
      ...ai,
      full_name: ai.full_name ?? basic.full_name,
      email: ai.email ?? basic.email,
      phone: ai.phone ?? basic.phone,
      skills: ai.skills?.length ? ai.skills : basic.skills,
      experience: ai.experience?.length ? ai.experience : basic.experience,
      education: ai.education?.length ? ai.education : basic.education,
      preferred_roles: ai.preferred_roles?.length ? ai.preferred_roles : basic.preferred_roles,
      current_location: ai.current_location ?? basic.current_location,
      preferred_locations: ai.preferred_locations?.length
        ? ai.preferred_locations
        : basic.preferred_locations,
      current_salary: ai.current_salary ?? basic.current_salary,
      expected_salary: ai.expected_salary ?? basic.expected_salary,
      notice_period: ai.notice_period ?? basic.notice_period,
      work_preference: ai.work_preference ?? basic.work_preference,
    };
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
      '*Core commands:*',
      '• *VIEW JOBS* — jobs matched to your profile',
      '• *APPLY 1* — save job & get apply link',
      '• *RESUME 1* — tailored DOCX resume for job #1',
      '• *COVER LETTER 1* — cover letter for job #1',
      '• *FIND JOBS react* — search by skill or role',
      '• *UPLOAD RESUME* — update your CV (PDF/DOCX)',
      '',
      '*Also:* *SHOW APPLICATIONS* · *RESET PROFILE* · *DELETE MY DATA*',
    ].join('\n');
  }

  private async cmdResetProfile(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    await this.profiles.resetProfile(profile.id, message.contact);
    await this.profiles.updateOnboarding(profile.id, 'awaiting_resume', {});
    await this.reply(
      message,
      'Profile reset. Let\'s start fresh! 🔄\n\nPlease upload your latest resume (PDF or DOCX).',
    );
  }

  private async cmdDeleteMyData(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const phone = message.contact.phone ?? profile.phone ?? 'unknown';
    const result = await this.privacy.deleteProfile(message.userId, profile.id, {
      type: 'job_seeker',
      label: phone,
    });

    if (!result) {
      await this.reply(message, 'No profile data found to delete.');
      return;
    }

    await this.reply(
      message,
      'Your CareerAI profile, resumes, applications, and generated documents have been permanently deleted. ✅\n\nYou can message again anytime to start a new profile.',
    );
  }

  private getResumeMedia(raw: Record<string, unknown> | undefined): {
    id?: string;
    mime?: string;
    fileName?: string;
  } | null {
    if (!raw) return null;
    const doc = raw.document as { id?: string; mime_type?: string; filename?: string } | undefined;
    if (doc?.id) {
      return { id: doc.id, mime: doc.mime_type, fileName: doc.filename };
    }
    const img = raw.image as { id?: string; mime_type?: string } | undefined;
    if (img?.id) {
      return { id: img.id, mime: img.mime_type ?? 'image/jpeg', fileName: 'resume.jpg' };
    }
    return null;
  }

  private async cmdSetAutoApply(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: {
        autoApplyConsent: enabled,
        autoApplyConsentAt: enabled ? new Date() : null,
      },
    });

    if (enabled) {
      await this.reply(
        message,
        'Assisted auto-apply enabled ✅\n\nWhen you reply *APPLY 1*, *APPLY 2*, etc., your application is queued for your career operator to submit on your behalf.\n\nReply *DISABLE AUTO APPLY* anytime to opt out.',
      );
    } else {
      await this.reply(message, 'Auto-apply disabled. Applications will be saved for you to apply manually.');
    }
  }

  private async cmdAutoApplyStatus(
    message: Message & { contact: Contact },
    profile: CareerProfile,
  ): Promise<void> {
    const on = profile.autoApplyConsent === true;
    await this.reply(
      message,
      on
        ? 'Assisted auto-apply is *ON* ✅\n\nReply *APPLY N* to queue a job. Reply *DISABLE AUTO APPLY* to turn off.'
        : 'Assisted auto-apply is *OFF*.\n\nReply *ENABLE AUTO APPLY* to queue applications with your operator.',
    );
  }

  private async cmdScheduleInterview(
    message: Message & { contact: Contact },
    profile: CareerProfile,
    text: string,
  ): Promise<void> {
    const slot = text
      .replace(/schedule\s+interview|book\s+interview|interview\s+slot/gi, '')
      .trim();

    if (!slot || slot.length < 3) {
      await this.reply(
        message,
        'Tell me your preferred slot, e.g.\n*SCHEDULE INTERVIEW Monday 3pm* or *Tuesday 10 AM IST*',
      );
      return;
    }

    const preferences = {
      requested_slot: slot,
      requested_at: new Date().toISOString(),
      channel: 'whatsapp',
    };

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: { interviewPreferences: preferences as Prisma.InputJsonValue },
    });

    await this.reply(
      message,
      `Interview preference saved ✅\n\n*${slot}*\n\nYour career operator will follow up to confirm scheduling.`,
    );
  }

  private getOnboardingSteps(): Record<
    string,
    { next: string; field: keyof CareerProfile; question: string }
  > {
    return {
      follow_up_location: {
        next: 'follow_up_preferred_location',
        field: 'currentLocation',
        question: 'What is your current city/location? (e.g. Mumbai, Pune)',
      },
      follow_up_preferred_location: {
        next: 'follow_up_current_salary',
        field: 'preferredLocations',
        question:
          'Where would you prefer to work? (city or "Remote", comma-separated for multiple)',
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
        question: 'Preferred work mode? Tap a button or type Remote / Hybrid / Onsite',
      },
      follow_up_roles: {
        next: 'complete',
        field: 'preferredRoles',
        question:
          'What roles are you targeting? (comma-separated, e.g. React Developer, Full Stack Engineer)',
      },
    };
  }

  private async promptOnboardingStep(
    message: Message & { contact: Contact },
    stepKey: string,
  ): Promise<void> {
    if (stepKey === 'follow_up_job_type') {
      await this.replyWorkModePrompt(message);
      return;
    }
    const question = this.getOnboardingSteps()[stepKey]?.question;
    if (question) {
      await this.reply(message, question);
    }
  }

  private async replyWorkModePrompt(
    message: Message & { contact: Contact },
    prefix?: string,
  ): Promise<void> {
    const body = [
      prefix,
      'Preferred work mode? Tap a button below or type *Remote*, *Hybrid*, or *Onsite*.',
    ]
      .filter(Boolean)
      .join('\n\n');
    await this.replyButtons(message, body, [...CAREER_WORK_MODE_BUTTONS]);
  }

  private async sendJobActionButtons(
    message: Message & { contact: Contact },
    jobCount: number,
  ): Promise<void> {
    const buttons = buildJobActionButtons(jobCount);
    if (buttons.length === 0) {
      return;
    }
    await this.replyButtons(message, 'Quick actions for these jobs:', buttons);
  }

  private async replyButtons(
    message: Message & { contact: Contact },
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { contactId: message.contactId },
    });
    if (!conversation) {
      return;
    }

    const result = await this.inbox.sendInteractiveButtons(
      message.userId,
      conversation.id,
      bodyText,
      buttons,
      { source: CAREER_BOT_MESSAGE_SOURCE },
    );

    if (!result.success) {
      await this.reply(message, bodyText);
    }
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
      where: { profileId: profile.id, userId, score: { gte: CAREER_MIN_MATCH_SCORE } },
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

  private parseCoverLetterIndex(lower: string): number | null {
    const match = lower.match(/^(?:generate\s+)?cover\s+letter\s*#?\s*(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
  }
}
