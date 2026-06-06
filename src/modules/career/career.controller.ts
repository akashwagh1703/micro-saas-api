import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { CAREER_APPLICATION_STATUSES } from './career.constants';
import { IsIn, IsOptional, IsString } from 'class-validator';

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
  ) {}

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
    };
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
        resumes: { orderBy: { createdAt: 'desc' }, take: 5 },
        jobMatches: { include: { job: true }, orderBy: { score: 'desc' }, take: 20 },
        applications: { include: { job: true } },
      },
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
  async fetchJobs(@CurrentUser('id') userId: number, @Body() dto: FetchJobsDto) {
    if (!this.fetcher.isEnabled()) {
      return {
        message: 'Job fetcher not configured. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in environment.',
        count: 0,
      };
    }
    const count = await this.fetcher.fetchAndStore(
      userId,
      dto.keyword,
      dto.location ?? 'india',
      3,
    );
    return { message: `Fetched and stored ${count} jobs for keyword "${dto.keyword}"`, count };
  }

  @Post('jobs/refresh')
  async refreshJobs() {
    if (!this.fetcher.isEnabled()) {
      return { message: 'Job fetcher not configured.', expired: 0, fetched: 0 };
    }
    const result = await this.refreshScheduler.run();
    return { message: 'Refresh complete', ...result };
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    const app = await this.prisma.careerApplication.findFirst({ where: { id, userId } });
    if (!app) {
      return { error: 'Not found' };
    }
    return this.applications.updateStatus(id, dto.status as any, dto.notes);
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
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Post('digest/run')
  async runDigest(@CurrentUser('id') userId: number) {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true },
      select: { id: true },
    });
    for (const p of profiles) {
      await this.digest.sendDailyDigestForProfile(p.id);
    }
    return { sent: profiles.length };
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
}
