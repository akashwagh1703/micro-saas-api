import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NormalizedJobListing } from './job-source.types';
import {
  clipField,
  detectSeniority,
  detectWorkMode,
  extractSkillsFromDescription,
  formatSalaryInr,
  mergeJobTags,
  normalizeContractType,
  normalizeSkillList,
  parseExperienceRange,
  parseSalaryFromText,
  thirtyDaysFromNow,
} from './job-source.utils';

@Injectable()
export class CareerJobUpsertService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: number, source: string, job: NormalizedJobListing): Promise<void> {
    const rawExternalId = String(job.externalId ?? '').trim();
    if (!rawExternalId) {
      throw new Error('Missing externalId');
    }

    const storageKey = this.toStorageKey(source, rawExternalId);

    const title = job.title?.trim() || 'Untitled role';
    const description = (job.description ?? '').slice(0, 3000);
    const rawSkills = job.requiredSkills?.length
      ? job.requiredSkills
      : extractSkillsFromDescription(description, title);
    const skills = normalizeSkillList(rawSkills.map(String));
    const expRange = parseExperienceRange(description);

    let salaryMin = job.salaryMin ?? null;
    let salaryMax = job.salaryMax ?? null;
    const salaryText = job.salaryText ?? formatSalaryInr(salaryMin, salaryMax);
    if (!salaryMin && !salaryMax) {
      const parsed = parseSalaryFromText(salaryText ?? description);
      salaryMin = parsed.min;
      salaryMax = parsed.max;
    }

    const workMode = detectWorkMode(
      title,
      description,
      job.location ?? '',
      job.jobType ?? '',
    );
    const seniority = detectSeniority(title, description);

    const enrichmentTags = mergeJobTags(job.tags, { workMode, seniority }) as Prisma.InputJsonValue;

    const shared = {
      title,
      company: job.company?.trim() || 'Unknown company',
      location: job.location ?? null,
      city: clipField(job.city, 80),
      salaryMin,
      salaryMax,
      salaryText: salaryText ?? formatSalaryInr(salaryMin, salaryMax),
      jobType: clipField(normalizeContractType(job.jobType), 30),
      description,
      requiredSkills: skills,
      minExperience: job.minExperience ?? expRange.min ?? null,
      experienceMax: job.experienceMax ?? expRange.max ?? null,
      tags: enrichmentTags,
      applyUrl: job.applyUrl ?? null,
      postedAt: job.postedAt ?? null,
      expiresAt: thirtyDaysFromNow(),
      industry: clipField(job.industry, 60),
      isActive: true,
      source,
      externalId: storageKey,
    };

    let existing = await this.prisma.careerJob.findFirst({
      where: { userId, externalId: storageKey },
      select: { id: true, tags: true },
    });

    if (!existing) {
      existing = await this.prisma.careerJob.findFirst({
        where: { userId, source, externalId: rawExternalId },
        select: { id: true, tags: true },
      });
    }

    if (existing) {
      await this.prisma.careerJob.update({
        where: { id: existing.id },
        data: {
          ...shared,
          tags: mergeJobTags(existing.tags, { workMode, seniority }) as Prisma.InputJsonValue,
        },
      });
      return;
    }

    await this.prisma.careerJob.create({
      data: {
        ...shared,
        userId,
      },
    });
  }

  private toStorageKey(source: string, externalId: string): string {
    const key = `${source}::${externalId}`;
    return key.length > 190 ? key.slice(0, 190) : key;
  }
}
