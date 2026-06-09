import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerJobService } from './services/career-job.service';
import { CareerJobFetcherService } from './services/career-job-fetcher.service';
import { CareerJobRefreshScheduler } from './career-job-refresh.scheduler';
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
  readCareerDocumentBuffer,
} from './career-document.util';
import { CareerDocxService } from './services/career-docx.service';
import { CAREER_APPLICATION_STATUSES } from './career.constants';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

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
  preferred_roles?: string[];

  @IsOptional()
  auto_apply_consent?: boolean;

  @IsOptional()
  interview_preferences?: Record<string, unknown>;
}

@Controller('career')
@UseGuards(TokenAuthGuard)
export class CareerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: CareerJobService,
    private readonly fetcher: CareerJobFetcherService,
    private readonly refreshScheduler: CareerJobRefreshScheduler,
    private readonly digest: CareerDigestService,
    private readonly applications: CareerApplicationService,
    private readonly storage: CareerStorageService,
    private readonly aiUsage: CareerAiUsageService,
    private readonly audit: CareerAuditService,
    private readonly privacy: CareerPrivacyService,
    private readonly bot: CareerBotService,
    private readonly docx: CareerDocxService,
  ) {}

  @Get('storage/status')
  async storageStatus() {
    return this.storage.getStorageStatus();
  }

  @Get('analytics')
  async analytics(@CurrentUser('id') userId: number) {
    const [profiles, resumes, jobs, matches, applications, notifications] = await Promise.all([
      this.prisma.careerProfile.count({ where: { userId } }),
      this.prisma.careerResume.count({ where: { userId } }),
      this.prisma.careerJob.count({ where: { userId, isActive: true } }),
      this.prisma.careerJobMatch.count({ where: { userId } }),
      this.prisma.careerApplication.count({ where: { userId } }),
      this.prisma.careerNotification.count({ where: { userId } }),
    ]);

    const completeProfiles = await this.prisma.careerProfile.count({
      where: { userId, isComplete: true },
    });

    const byStatus = await this.prisma.careerApplication.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    });

    return {
      profiles,
      complete_profiles: completeProfiles,
      resumes,
      jobs,
      matches,
      applications,
      notifications,
      applications_by_status: byStatus,
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
  listJobSources() {
    return { sources: this.fetcher.listSources() };
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
    return this.prisma.careerProfile.findFirst({
      where: { id, userId },
      include: {
        contact: true,
        resumes: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            versions: { orderBy: { createdAt: 'desc' }, take: 10, include: { job: true } },
          },
        },
        jobMatches: { include: { job: true }, orderBy: { score: 'desc' }, take: 20 },
        applications: { include: { job: true } },
        coverLetters: { orderBy: { createdAt: 'desc' }, take: 10, include: { job: true } },
      },
    });
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

    return this.prisma.careerProfile.update({
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
    const result = await this.bot.rematchProfile(userId, id);
    if (!result) {
      throw new NotFoundException('Profile not found');
    }
    return {
      message: `Re-matched profile — ${result.matchCount} strong matches (70%+ score)`,
      ...result,
    };
  }

  @Post('resume-versions/:id/send')
  async sendResumeVersion(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.bot.sendResumeVersionToContact(userId, id);
    if (!result.success) {
      throw new UnprocessableEntityException(result.error ?? 'Could not send resume on WhatsApp');
    }
    return { message: 'Resume sent on WhatsApp', success: true };
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
    const statuses = this.fetcher.listSources();
    if (!this.fetcher.isEnabled()) {
      return {
        message:
          'No job sources configured. Set ADZUNA_APP_ID/KEY and/or JSEARCH_RAPIDAPI_KEY in API env.',
        count: 0,
        by_source: {},
        sources: statuses,
      };
    }

    const result = await this.fetcher.fetchAndStoreDetailed(
      userId,
      dto.keyword,
      dto.location ?? 'india',
      2,
      source,
    );

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
    };
  }

  @Post('jobs/refresh')
  async refreshJobs(@CurrentUser('id') userId: number) {
    if (!this.fetcher.isEnabled()) {
      return { message: 'Job fetcher not configured.', expired: 0, fetched: 0, by_source: {} };
    }
    const result = await this.refreshScheduler.runForUser(userId);
    const breakdown = Object.entries(result.bySource ?? {})
      .map(([id, n]) => `${id}: ${n}`)
      .join(', ');
    return {
      message: breakdown
        ? `Refresh complete — ${result.fetched} jobs (${breakdown})`
        : `Refresh complete — ${result.fetched} jobs fetched`,
      ...result,
      by_source: result.bySource,
    };
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
  async notifications(@CurrentUser('id') userId: number) {
    return this.prisma.careerNotification.findMany({
      where: { userId },
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
        'interview_ai_agent',
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

  @Get('resume-versions/:id/download')
  async downloadResumeVersion(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const version = await this.prisma.careerResumeVersion.findFirst({
      where: { id, userId },
      include: { job: true },
    });
    if (!version?.filePathDocx && !version?.filePath && !version?.content) {
      throw new NotFoundException('Generated resume not found');
    }

    let buffer = await readCareerDocumentBuffer(this.storage, version);
    if (!buffer) {
      throw new NotFoundException('Generated resume file unavailable');
    }

    if (!version.filePathDocx && !version.filePath?.endsWith('.docx')) {
      const title = version.job
        ? `${version.job.title} — tailored`
        : version.title ?? 'Tailored resume';
      buffer = await this.docx.resumeFromText(title, version.content ?? buffer.toString('utf8'));
    }

    const fileName = careerDocxFileName(
      version.title ?? version.job?.title ?? `resume-version-${id}`,
    );
    return careerDocxStreamable(buffer, fileName);
  }

  @Get('cover-letters/:id/download')
  async downloadCoverLetterVersion(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const letter = await this.prisma.careerCoverLetter.findFirst({
      where: { id, userId },
      include: { job: true },
    });
    if (!letter?.filePathDocx && !letter?.filePath && !letter?.content) {
      throw new NotFoundException('Cover letter not found');
    }

    let buffer = await readCareerDocumentBuffer(this.storage, letter);
    if (!buffer) {
      throw new NotFoundException('Cover letter file unavailable');
    }

    if (!letter.filePathDocx && !letter.filePath?.endsWith('.docx')) {
      const title = letter.job
        ? `Cover Letter — ${letter.job.title} @ ${letter.job.company}`
        : 'Cover letter';
      buffer = await this.docx.coverLetterFromText(title, letter.content ?? buffer.toString('utf8'));
    }

    const fileName = careerDocxFileName(
      letter.job
        ? `cover-letter-${letter.job.company}-${letter.job.title}`
        : `cover-letter-${id}`,
    );
    return careerDocxStreamable(buffer, fileName);
  }
}
