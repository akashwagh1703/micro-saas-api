import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CareerProfile } from '@prisma/client';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerJobService } from './services/career-job.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';
import { CareerJobRefreshScheduler } from './career-job-refresh.scheduler';
import { CareerJobAlertService } from './services/career-job-alert.service';
import { CareerDigestService } from './services/career-digest.service';
import { CareerApplicationService } from './services/career-application.service';
import { CareerStorageService } from './services/career-storage.service';
import { CareerAiUsageService } from './services/career-ai-usage.service';
import { CareerAuditService } from './services/career-audit.service';
import { CareerPrivacyService } from './services/career-privacy.service';
import { CareerBotService } from './services/career-bot.service';
import {
  careerDocxFileName,
  careerDocxStreamable,
  careerPdfFileName,
  careerPdfStreamable,
  readCareerDocumentBuffer,
  type CareerDocumentFormat,
} from './career-document.util';
import { CareerDocxService } from './services/career-docx.service';
import { CareerPdfService } from './services/career-pdf.service';
import { readInterviewHistory } from './career-interview-state.util';
import { readGuidanceHistory } from './career-guidance-state.util';
import { readAlertPreferences, mergeAlertPreferencesPatch } from './career-alert-preferences.util';
import { CareerGuidanceService } from './services/career-guidance.service';
import { CareerPortalShareService } from './services/career-portal-share.service';
import { CareerTenantSettingsService } from './services/career-tenant-settings.service';
import { CareerMatchAnalyticsService } from './services/career-match-analytics.service';
import { CareerZeroMatchService } from './services/career-zero-match.service';
import { CareerProfileRematchService } from './services/career-profile-rematch.service';
import { profileMatchFieldsChanged } from './career-profile-match.util';
import { UpdateCareerSettingsDto } from './dto/career-settings.dto';
import { RejectPaymentSubmissionDto } from '../billing/dto/billing.dto';
import { CareerSeekerManualPaymentService } from './services/career-seeker-manual-payment.service';
import { CareerUpiConfigService } from './services/career-upi-config.service';
import { CAREER_APPLICATION_STATUSES } from './career.constants';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

class UpdateApplicationStatusDto {
  @IsIn(CAREER_APPLICATION_STATUSES as unknown as string[])
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class FetchJobsDto {
  @IsString()
  keyword: string;

  @IsOptional()
  @IsString()
  location?: string;
}

class CreateJobDto {
  @IsString()
  title: string;

  @IsString()
  company: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  salary_text?: string;

  @IsOptional()
  @IsString()
  job_type?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateCareerProfileDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  current_location?: string;

  @IsOptional()
  @IsArray()
  preferred_locations?: string[];

  @IsOptional()
  @IsString()
  current_salary?: string;

  @IsOptional()
  @IsString()
  expected_salary?: string;

  @IsOptional()
  @IsString()
  notice_period?: string;

  @IsOptional()
  @IsString()
  work_preference?: string;

  @IsOptional()
  @IsArray()
  preferred_job_types?: string[];

  @IsOptional()
  @IsArray()
  preferred_roles?: string[];

  @IsOptional()
  auto_apply_consent?: boolean;

  @IsOptional()
  interview_preferences?: Record<string, unknown>;
}

class UpdateAlertPreferencesDto {
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  in_app?: boolean;
}

@Controller('career')
@UseGuards(TokenAuthGuard)
export class CareerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: CareerJobService,
    private readonly fetcher: CareerJobFetcherService,
    private readonly refreshScheduler: CareerJobRefreshScheduler,
    private readonly jobAlerts: CareerJobAlertService,
    private readonly digest: CareerDigestService,
    private readonly applications: CareerApplicationService,
    private readonly storage: CareerStorageService,
    private readonly aiUsage: CareerAiUsageService,
    private readonly audit: CareerAuditService,
    private readonly privacy: CareerPrivacyService,
    private readonly bot: CareerBotService,
    private readonly docx: CareerDocxService,
    private readonly pdf: CareerPdfService,
    private readonly guidance: CareerGuidanceService,
    private readonly portalShare: CareerPortalShareService,
    private readonly careerSettings: CareerTenantSettingsService,
    private readonly seekerManualPayment: CareerSeekerManualPaymentService,
    private readonly upiConfig: CareerUpiConfigService,
    private readonly matchAnalytics: CareerMatchAnalyticsService,
    private readonly zeroMatch: CareerZeroMatchService,
    private readonly profileRematch: CareerProfileRematchService,
  ) {}

  @Get('settings')
  async getSettings(@CurrentUser('id') userId: number) {
    return this.careerSettings.getOperatorSettingsResponse(userId);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateCareerSettingsDto,
  ) {
    await this.careerSettings.saveOperatorSettings(userId, dto);
    return this.careerSettings.getOperatorSettingsResponse(userId);
  }

  @Get('billing/payment-config')
  async billingPaymentConfig(@CurrentUser('id') userId: number) {
    return this.seekerManualPayment.getPaymentConfig(userId);
  }

  @Post('billing/upi-qr')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadBillingUpiQr(
    @CurrentUser('id') userId: number,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      return { message: 'No file uploaded', upi_qr_url: null };
    }
    const upi_qr_url = await this.upiConfig.saveQrImage(userId, file.buffer, file.mimetype);
    return { message: 'UPI QR saved', upi_qr_url };
  }

  @Get('billing/upi-qr')
  async billingUpiQr(@CurrentUser('id') userId: number, @Res() res: Response) {
    const file = await this.upiConfig.readQrImage(userId);
    if (!file) {
      throw new NotFoundException('QR code not found');
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  }

  @Get('payment-submissions')
  listPaymentSubmissions(
    @CurrentUser('id') userId: number,
    @Query('status') status = 'pending',
    @Query('page') page = '1',
  ) {
    return this.seekerManualPayment.listSubmissions(userId, {
      status: status || undefined,
      page: parseInt(page, 10) || 1,
    });
  }

  @Get('payment-submissions/:id')
  getPaymentSubmission(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.seekerManualPayment.getSubmission(userId, id);
  }

  @Get('payment-submissions/:id/screenshot')
  async paymentScreenshot(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.seekerManualPayment.readSubmissionScreenshot(userId, id);
    res.setHeader('Content-Type', file.mimeType);
    res.send(file.buffer);
  }

  @Post('payment-submissions/:id/approve')
  approvePaymentSubmission(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.seekerManualPayment.approveSubmission(userId, id);
  }

  @Post('payment-submissions/:id/reject')
  rejectPaymentSubmission(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPaymentSubmissionDto,
  ) {
    return this.seekerManualPayment.rejectSubmission(userId, id, dto.reason);
  }

  @Get('storage/status')
  async storageStatus() {
    return this.storage.getStorageStatus();
  }

  @Get('analytics')
  async analytics(@CurrentUser('id') userId: number) {
    const metrics = await this.matchAnalytics.getOperatorMetrics(userId);
    return {
      ...metrics,
      ai_usage: await this.aiUsage.getMonthlyStats(userId),
    };
  }

  @Get('ai-usage')
  async aiUsageStats(@CurrentUser('id') userId: number) {
    return this.aiUsage.getMonthlyStats(userId);
  }

  @Get('audit-log')
  async auditLog(@CurrentUser('id') userId: number, @Query('page') page = '1') {
    return this.audit.listForUser(userId, parseInt(page, 10) || 1);
  }

  @Get('job-sources')
  async listJobSources(@CurrentUser('id') userId: number) {
    return { sources: await this.fetcher.listSources(userId) };
  }

  @Get('profiles')
  async profiles(@CurrentUser('id') userId: number, @Query('page') page = '1') {
    const perPage = 20;
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * perPage;
    const [items, total] = await Promise.all([
      this.prisma.careerProfile.findMany({
        where: { userId },
        include: { contact: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.careerProfile.count({ where: { userId } }),
    ]);
    return { items, total, page: parseInt(page, 10), per_page: perPage };
  }

  @Get('profiles/:id')
  async profileDetail(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id, userId },
      include: {
        contact: true,
        resumes: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        jobMatches: { include: { job: true }, orderBy: { score: 'desc' }, take: 20 },
        applications: { include: { job: true } },
        coverLetters: { orderBy: { createdAt: 'desc' }, take: 10, include: { job: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return {
      ...profile,
      interview_sessions: readInterviewHistory(profile.onboardingData),
      guidance_history: readGuidanceHistory(profile.onboardingData),
      alert_preferences: readAlertPreferences(profile.onboardingData),
    };
  }

  @Patch('profiles/:id/alert-preferences')
  async updateAlertPreferences(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlertPreferencesDto,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({ where: { id, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const patch: Record<string, boolean> = {};
    if (dto.whatsapp !== undefined) patch.whatsapp = dto.whatsapp;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.in_app !== undefined) patch.in_app = dto.in_app;

    return this.prisma.careerProfile.update({
      where: { id },
      data: {
        onboardingData: mergeAlertPreferencesPatch(profile.onboardingData, patch),
      },
    });
  }

  @Post('profiles/:id/portal-link')
  async sendPortalLink(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.bot.sendPortalLinkToContact(userId, id);
    if (!result.success && !result.url) {
      throw new UnprocessableEntityException(result.error ?? 'Could not send portal link');
    }
    return {
      message: result.success ? 'Portal link sent on WhatsApp' : 'Portal link generated',
      url: result.url ?? this.portalShare.buildPortalUrl(id, userId),
      success: result.success,
    };
  }

  @Get('profiles/:id/portal-url')
  async getPortalUrl(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    const profile = await this.prisma.careerProfile.findFirst({ where: { id, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return { url: this.portalShare.buildPortalUrl(profile.id, userId) };
  }

  @Get('profiles/:id/guidance')
  async listGuidance(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id, userId },
      select: { id: true, onboardingData: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return { items: readGuidanceHistory(profile.onboardingData) };
  }

  @Post('profiles/:id/guidance/roadmap')
  async generateGuidanceRoadmap(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runGuidanceAction(userId, id, (profile) =>
      this.guidance.generateRoadmap(userId, profile),
    );
  }

  @Post('profiles/:id/guidance/skill-gap')
  async generateGuidanceSkillGap(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runGuidanceAction(userId, id, (profile) =>
      this.guidance.generateSkillGap(userId, profile),
    );
  }

  @Post('profiles/:id/guidance/certifications')
  async generateGuidanceCertifications(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runGuidanceAction(userId, id, (profile) =>
      this.guidance.generateCertifications(userId, profile),
    );
  }

  @Post('profiles/:id/guidance/salary')
  async generateGuidanceSalary(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runGuidanceAction(userId, id, (profile) =>
      this.guidance.generateSalary(userId, profile),
    );
  }

  @Post('profiles/:id/guidance/full')
  async generateGuidanceFull(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({ where: { id, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    const chunks = await this.guidance.generateFullSummary(userId, profile);
    const items = readGuidanceHistory(
      (
        await this.prisma.careerProfile.findFirst({
          where: { id, userId },
          select: { onboardingData: true },
        })
      )?.onboardingData,
    );
    return {
      message: 'Full career guidance generated',
      chunks,
      item: items[0] ?? null,
    };
  }

  @Get('profiles/:id/interview-sessions')
  async listInterviewSessions(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id, userId },
      select: { id: true, onboardingData: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return { items: readInterviewHistory(profile.onboardingData) };
  }

  @Patch('profiles/:id')
  async updateProfile(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCareerProfileDto,
  ) {
    const existing = await this.prisma.careerProfile.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException('Profile not found');
    }

    const updated = await this.prisma.careerProfile.update({
      where: { id },
      data: {
        fullName: dto.full_name,
        email: dto.email,
        currentLocation: dto.current_location,
        preferredLocations: dto.preferred_locations as any,
        currentSalary: dto.current_salary,
        expectedSalary: dto.expected_salary,
        noticePeriod: dto.notice_period,
        workPreference: dto.work_preference,
        preferredJobTypes: dto.preferred_job_types as any,
        preferredRoles: dto.preferred_roles as any,
        ...(dto.auto_apply_consent !== undefined
          ? {
              autoApplyConsent: dto.auto_apply_consent,
              autoApplyConsentAt: dto.auto_apply_consent ? new Date() : null,
            }
          : {}),
        ...(dto.interview_preferences !== undefined
          ? { interviewPreferences: dto.interview_preferences as any }
          : {}),
      },
    });

    const rematch = await this.profileRematch.rematchIfProfileChanged(userId, existing, updated);

    return {
      ...updated,
      match_fields_changed: profileMatchFieldsChanged(existing, updated),
      ...(rematch ? { rematch } : {}),
    };
  }

  @Delete('profiles/:id')
  async deleteProfile(
    @CurrentUser('id') userId: number,
    @CurrentUser('email') userEmail: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.privacy.deleteProfile(userId, id, {
      type: 'operator',
      label: userEmail,
    });
    if (!result) {
      throw new NotFoundException('Profile not found');
    }
    return result;
  }

  @Post('profiles/:id/rematch')
  async rematchProfile(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({ where: { id, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const result = await this.profileRematch.rematchProfile(userId, profile);
    return {
      message: `Re-matched profile — ${result.matchCount} matches (65%+ score), ${result.strongMatchCount} strong (80%+)`,
      ...result,
    };
  }

  @Post('profiles/:id/zero-match-playbook')
  async zeroMatchPlaybook(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fetch?: boolean; rematch?: boolean; location?: string } = {},
  ) {
    const result = await this.zeroMatch.runPlaybook(userId, id, {
      fetch: body.fetch ?? true,
      rematch: body.rematch ?? true,
      location: body.location,
    });
    if (!result) {
      throw new NotFoundException('Profile not found');
    }
    return result;
  }

  @Post('cover-letters/:id/send')
  async sendCoverLetter(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.bot.sendCoverLetterToContact(userId, id);
    if (!result.success) {
      throw new UnprocessableEntityException(result.error ?? 'Could not send cover letter on WhatsApp');
    }
    return { message: 'Cover letter sent on WhatsApp', success: true };
  }

  @Get('cover-letters')
  async listCoverLetters(
    @CurrentUser('id') userId: number,
    @Query('profile_id') profileId?: string,
  ) {
    return this.prisma.careerCoverLetter.findMany({
      where: {
        userId,
        ...(profileId ? { profileId: parseInt(profileId, 10) } : {}),
      },
      include: { job: true, profile: { include: { contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('jobs')
  async listJobs(@CurrentUser('id') userId: number) {
    return this.jobs.listActive(userId);
  }

  @Post('jobs')
  async createJob(@CurrentUser('id') userId: number, @Body() dto: CreateJobDto) {
    return this.prisma.careerJob.create({
      data: {
        userId,
        title: dto.title,
        company: dto.company,
        location: dto.location,
        salaryText: dto.salary_text,
        jobType: dto.job_type,
        description: dto.description,
        source: 'admin',
      },
    });
  }

  @Post('jobs/fetch')
  async fetchJobs(
    @CurrentUser('id') userId: number,
    @Body() dto: FetchJobsDto,
    @Query('source') source?: string,
  ) {
    const statuses = await this.fetcher.listSources(userId);
    if (!(await this.fetcher.isEnabled(userId))) {
      return {
        message:
          'No job sources configured. Add Adzuna and/or JSearch keys in Settings → CareerAI.',
        count: 0,
        by_source: {},
        sources: statuses,
      };
    }

    const fetchStartedAt = new Date();
    const result = await this.fetcher.fetchAndStoreDetailed(
      userId,
      dto.keyword,
      dto.location ?? 'india',
      1,
      source,
    );

    const newJobIds = await this.fetcher.findJobsCreatedSince(userId, fetchStartedAt);
    const alertResult = await this.jobAlerts.processNewJobsForUser(userId, newJobIds);

    const parts = Object.entries(result.bySource)
      .map(([id, n]) => `${id}: ${n}`)
      .join(', ');

    const errorParts = Object.entries(result.errors)
      .map(([id, err]) => `${id} failed (${err})`)
      .join('; ');

    let message = `Fetched ${result.total} jobs for "${dto.keyword}"`;
    if (parts) message += ` (${parts})`;
    if (errorParts) message += `. ${errorParts}`;

    return {
      message,
      count: result.total,
      by_source: result.bySource,
      errors: result.errors,
      sources: statuses,
      new_jobs: newJobIds.length,
      alerts_sent: alertResult.sent,
    };
  }

  @Post('jobs/refresh')
  @HttpCode(202)
  async refreshJobs(@CurrentUser('id') userId: number) {
    if (!(await this.fetcher.isEnabled(userId))) {
      return {
        status: 'unconfigured',
        message: 'Job fetcher not configured. Add keys in Settings → CareerAI.',
        expired: 0,
        fetched: 0,
        by_source: {},
      };
    }
    const { status, message } = this.refreshScheduler.startForUser(userId);
    return { status, message };
  }

  @Post('jobs/seed')
  async seedJobs(@CurrentUser('id') userId: number) {
    const count = await this.jobs.ensureSampleJobs(userId);
    return { message: 'Sample jobs ready', count };
  }

  @Get('applications')
  async listApplications(@CurrentUser('id') userId: number) {
    return this.prisma.careerApplication.findMany({
      where: { userId },
      include: { job: true, profile: { include: { contact: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Patch('applications/:id/status')
  async updateApplication(
    @CurrentUser('id') userId: number,
    @CurrentUser('email') userEmail: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    const app = await this.prisma.careerApplication.findFirst({ where: { id, userId } });
    if (!app) {
      return { error: 'Not found' };
    }
    return this.applications.updateStatus(id, dto.status as any, dto.notes, {
      userId,
      label: userEmail,
    });
  }

  @Get('matches')
  async matches(@CurrentUser('id') userId: number, @Query('profile_id') profileId?: string) {
    return this.prisma.careerJobMatch.findMany({
      where: {
        userId,
        ...(profileId ? { profileId: parseInt(profileId, 10) } : {}),
      },
      include: { job: true, profile: { include: { contact: true } } },
      orderBy: { score: 'desc' },
      take: 100,
    });
  }

  @Get('notifications')
  async notifications(
    @CurrentUser('id') userId: number,
    @Query('profile_id') profileId?: string,
    @Query('type') type?: string,
  ) {
    return this.prisma.careerNotification.findMany({
      where: {
        userId,
        ...(profileId ? { profileId: parseInt(profileId, 10) } : {}),
        ...(type ? { type } : {}),
      },
      include: {
        profile: { include: { contact: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Post('digest/run')
  async runDigest(@CurrentUser('id') userId: number) {
    const result = await this.digest.runDailyDigestForUser(userId);
    return {
      message: `Digest run complete — ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`,
      ...result,
    };
  }

  @Post('setup')
  async setup(@CurrentUser('id') userId: number) {
    await this.jobs.ensureSampleJobs(userId);
    return {
      message: 'CareerAI Bot enabled',
      business_category: 'career_ai',
      future_modules: [
        'browser_extension',
        'ats_integration',
        'auto_apply',
        'linkedin_integration',
        'naukri_integration',
        'salary_predictor',
        'career_coach',
      ],
    };
  }

  @Get('resumes/:id/download')
  async downloadResume(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const resume = await this.prisma.careerResume.findFirst({ where: { id, userId } });
    if (!resume?.filePath) {
      throw new NotFoundException('Resume file not found');
    }

    const buffer = await this.storage.readBuffer(resume.filePath);
    if (!buffer) {
      throw new NotFoundException('Resume file unavailable');
    }

    const fileName = resume.fileName ?? `resume-${id}.pdf`;
    return new StreamableFile(buffer, {
      type: resume.mimeType ?? 'application/octet-stream',
      disposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
  }

  @Get('cover-letters/:id/download')
  async downloadCoverLetterVersion(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format?: string,
  ): Promise<StreamableFile> {
    const docFormat: CareerDocumentFormat =
      format?.trim().toLowerCase() === 'docx' ? 'docx' : 'pdf';
    const letter = await this.prisma.careerCoverLetter.findFirst({
      where: { id, userId },
      include: { job: true },
    });
    if (!letter?.filePathDocx && !letter?.filePathPdf && !letter?.filePath && !letter?.content) {
      throw new NotFoundException('Cover letter not found');
    }

    const title = letter.job
      ? `Cover Letter — ${letter.job.title} @ ${letter.job.company}`
      : 'Cover letter';
    const baseName = letter.job
      ? `cover-letter-${letter.job.company}-${letter.job.title}`
      : `cover-letter-${id}`;

    return this.streamGeneratedDocument(
      letter,
      docFormat,
      title,
      baseName,
      (t, body) => this.docx.coverLetterFromText(t, body),
      (t, body) => this.pdf.fromText(t, body),
    );
  }

  private async runGuidanceAction(
    userId: number,
    profileId: number,
    action: (profile: CareerProfile) => Promise<unknown>,
  ) {
    const profile = await this.prisma.careerProfile.findFirst({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    const item = await action(profile);
    return { message: 'Guidance generated', item };
  }

  private async streamGeneratedDocument(
    record: {
      filePathPdf?: string | null;
      filePathDocx?: string | null;
      filePath?: string | null;
      content?: string | null;
    },
    format: CareerDocumentFormat,
    title: string,
    baseName: string,
    toDocx: (title: string, body: string) => Promise<Buffer>,
    toPdf: (title: string, body: string) => Promise<Buffer>,
  ): Promise<StreamableFile> {
    let buffer = await readCareerDocumentBuffer(this.storage, record, format);
    const plainText = record.content ?? (buffer ? buffer.toString('utf8') : '');

    if (!buffer && plainText) {
      buffer =
        format === 'pdf'
          ? await toPdf(title, plainText)
          : await toDocx(title, plainText);
    } else if (buffer && plainText && buffer.length < 256 && format === 'docx') {
      buffer = await toDocx(title, plainText);
    } else if (buffer && plainText && buffer.length < 256 && format === 'pdf') {
      buffer = await toPdf(title, plainText);
    }

    if (!buffer) {
      throw new NotFoundException('Document file unavailable');
    }

    if (format === 'pdf') {
      return careerPdfStreamable(buffer, careerPdfFileName(baseName));
    }
    return careerDocxStreamable(buffer, careerDocxFileName(baseName));
  }
}
