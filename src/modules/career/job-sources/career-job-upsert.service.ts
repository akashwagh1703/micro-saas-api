import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NormalizedJobListing } from './job-source.types';
import {
  clipField,
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
    const rawExternalId = String(job.externalId ?? '').trim();
    if (!rawExternalId) {
      throw new Error('Missing externalId');
    }

    const storageKey = this.toStorageKey(source, rawExternalId);

    const description = (job.description ?? '').slice(0, 3000);
    const skills = job.requiredSkills?.length
      ? job.requiredSkills
      : extractSkillsFromDescription(description, job.title ?? '');
    const expRange = parseExperienceRange(description);
    const salaryMin = job.salaryMin ?? null;
    const salaryMax = job.salaryMax ?? null;

    const shared = {
      title: job.title?.trim() || 'Untitled role',
      company: job.company?.trim() || 'Unknown company',
      location: job.location ?? null,
      city: clipField(job.city, 80),
      salaryMin,
      salaryMax,
      salaryText: job.salaryText ?? formatSalaryInr(salaryMin, salaryMax),
      jobType: clipField(normalizeContractType(job.jobType), 30),
      description,
      requiredSkills: skills,
      minExperience: job.minExperience ?? expRange.min ?? null,
      experienceMax: job.experienceMax ?? expRange.max ?? null,
      tags: job.tags ?? [],
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
      select: { id: true },
    });

    // Legacy rows stored raw Adzuna ids without source prefix — migrate on update.
    if (!existing) {
      existing = await this.prisma.careerJob.findFirst({
        where: { userId, source, externalId: rawExternalId },
        select: { id: true },
      });
    }

    if (existing) {
      await this.prisma.careerJob.update({
        where: { id: existing.id },
        data: shared,
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

  /** Prevents Adzuna/JSearch id collisions in @@unique([userId, externalId]). */
  private toStorageKey(source: string, externalId: string): string {
    const key = `${source}::${externalId}`;
    return key.length > 190 ? key.slice(0, 190) : key;
  }
}
