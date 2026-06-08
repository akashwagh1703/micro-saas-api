import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NormalizedJobListing } from './job-source.types';
import {
  extractSkillsFromDescription,
  formatSalaryInr,
  normalizeContractType,
  parseExperienceRange,
  thirtyDaysFromNow,
} from './job-source.utils';

@Injectable()
export class CareerJobUpsertService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: number, source: string, job: NormalizedJobListing): Promise<void> {
    const description = (job.description ?? '').slice(0, 3000);
    const skills = job.requiredSkills?.length
      ? job.requiredSkills
      : extractSkillsFromDescription(description);
    const expRange = parseExperienceRange(description);
    const salaryMin = job.salaryMin ?? null;
    const salaryMax = job.salaryMax ?? null;

    await this.prisma.careerJob.upsert({
      where: {
        userId_externalId: { userId, externalId: job.externalId },
      },
      create: {
        userId,
        title: job.title,
        company: job.company,
        location: job.location,
        city: job.city,
        salaryMin,
        salaryMax,
        salaryText: job.salaryText ?? formatSalaryInr(salaryMin, salaryMax),
        jobType: normalizeContractType(job.jobType),
        description,
        requiredSkills: skills,
        minExperience: job.minExperience ?? expRange.min ?? null,
        experienceMax: job.experienceMax ?? expRange.max ?? null,
        tags: job.tags ?? [],
        applyUrl: job.applyUrl,
        postedAt: job.postedAt,
        expiresAt: thirtyDaysFromNow(),
        industry: job.industry,
        source,
        externalId: job.externalId,
        isActive: true,
      },
      update: {
        title: job.title,
        company: job.company,
        location: job.location,
        city: job.city,
        salaryMin,
        salaryMax,
        salaryText: job.salaryText ?? formatSalaryInr(salaryMin, salaryMax),
        description,
        requiredSkills: skills,
        minExperience: job.minExperience ?? expRange.min ?? undefined,
        experienceMax: job.experienceMax ?? expRange.max ?? undefined,
        tags: job.tags ?? [],
        applyUrl: job.applyUrl,
        expiresAt: thirtyDaysFromNow(),
        isActive: true,
      },
    });
  }
}
