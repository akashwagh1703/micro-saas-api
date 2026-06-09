import { Injectable } from '@nestjs/common';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const SAMPLE_JOBS = [
  {
    title: 'React Developer',
    company: 'TechNova Labs',
    location: 'Remote',
    salaryText: '₹12–18 LPA',
    jobType: 'remote',
    description: 'Build modern React apps. Requires React, TypeScript, REST APIs.',
    requiredSkills: ['react', 'javascript', 'typescript', 'rest'],
    minExperience: 2,
    experienceMax: 6,
  },
  {
    title: 'Full Stack Developer',
    company: 'CloudStack India',
    location: 'Bangalore',
    salaryText: '₹15–22 LPA',
    jobType: 'hybrid',
    description: 'Laravel + React full stack role. Team lead opportunities.',
    requiredSkills: ['laravel', 'react', 'mysql', 'php'],
    minExperience: 3,
    experienceMax: 8,
  },
  {
    title: 'Frontend Engineer',
    company: 'DesignFirst',
    location: 'Pune',
    salaryText: '₹10–16 LPA',
    jobType: 'onsite',
    description: 'UI engineering with React and design systems.',
    requiredSkills: ['react', 'css', 'javascript'],
    minExperience: 2,
    experienceMax: 5,
  },
  {
    title: 'Node.js Backend Developer',
    company: 'APIWorks',
    location: 'Mumbai',
    salaryText: '₹14–20 LPA',
    jobType: 'hybrid',
    description: 'NestJS/Node microservices, PostgreSQL, Redis.',
    requiredSkills: ['nodejs', 'nestjs', 'postgresql', 'redis'],
    minExperience: 3,
    experienceMax: 7,
  },
  {
    title: 'DevOps Engineer',
    company: 'InfraPulse',
    location: 'Remote',
    salaryText: '₹18–28 LPA',
    jobType: 'remote',
    description: 'AWS, Docker, CI/CD pipelines.',
    requiredSkills: ['aws', 'docker', 'kubernetes', 'ci/cd'],
    minExperience: 4,
    experienceMax: 10,
  },
];

@Injectable()
export class CareerJobService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seeds the 5 sample jobs only when there are no real (adzuna/admin) jobs yet.
   * Once Adzuna fetches real data the seed is never re-inserted, preventing
   * fake companies from appearing alongside real listings.
   */
  async ensureSampleJobs(userId: number): Promise<number> {
    // If any non-seed real jobs exist (adzuna, jsearch, admin, etc.), skip seeding entirely.
    const realCount = await this.prisma.careerJob.count({
      where: { userId, source: { notIn: ['seed'] } },
    });
    if (realCount > 0) return realCount;

    // If seed jobs already exist, nothing to do.
    const seedCount = await this.prisma.careerJob.count({
      where: { userId, source: 'seed' },
    });
    if (seedCount > 0) return seedCount;

    for (const job of SAMPLE_JOBS) {
      await this.prisma.careerJob.create({
        data: {
          userId,
          title: job.title,
          company: job.company,
          location: job.location,
          salaryText: job.salaryText,
          jobType: job.jobType,
          description: job.description,
          requiredSkills: job.requiredSkills,
          minExperience: job.minExperience,
          experienceMax: job.experienceMax,
          source: 'seed',
        },
      });
    }

    return SAMPLE_JOBS.length;
  }

  async listActive(userId: number) {
    return this.prisma.careerJob.findMany({
      where: { userId, isActive: true },
      orderBy: [
        // Real jobs (adzuna/admin) appear before seed jobs.
        { source: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  searchByKeyword(jobs: CareerJob[], keyword: string): CareerJob[] {
    const k = keyword.toLowerCase();
    return jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(k) ||
        j.company.toLowerCase().includes(k) ||
        (j.description ?? '').toLowerCase().includes(k) ||
        (Array.isArray(j.requiredSkills) &&
          (j.requiredSkills as string[]).some((s) => s.toLowerCase().includes(k))),
    );
  }

  /** Primary search terms from profile — roles, skills, latest job title. */
  getProfileSearchKeywords(profile: CareerProfile): string[] {
    const keywords = new Set<string>();
    for (const role of this.asArray(profile.preferredRoles)) {
      const words = role.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      if (words.length >= 2) {
        keywords.add(words.slice(0, 2).join(' '));
      }
      keywords.add(role.toLowerCase());
    }
    for (const skill of this.asArray(profile.skills).slice(0, 5)) {
      keywords.add(skill.toLowerCase());
    }
    const experience = profile.experience as Array<{ title?: string }> | null;
    if (Array.isArray(experience)) {
      for (const entry of experience.slice(0, 2)) {
        if (entry?.title) {
          keywords.add(entry.title.toLowerCase());
        }
      }
    }
    return [...keywords].filter(Boolean).slice(0, 8);
  }

  /**
   * Narrows the job pool using the seeker's role, skills, and location before scoring.
   * Falls back to the full list when nothing matches (avoids empty results).
   */
  relevantJobsForProfile(jobs: CareerJob[], profile: CareerProfile): CareerJob[] {
    const roles = this.asArray(profile.preferredRoles).map((r) => r.toLowerCase());
    const skills = this.asArray(profile.skills).map((s) => s.toLowerCase());
    const locations = [
      profile.currentLocation?.toLowerCase(),
      ...this.asArray(profile.preferredLocations).map((l) => l.toLowerCase()),
    ].filter(Boolean) as string[];

    if (roles.length === 0 && skills.length === 0 && locations.length === 0) {
      return jobs;
    }

    const scored = jobs.map((job) => {
      const title = job.title.toLowerCase();
      const desc = (job.description ?? '').toLowerCase();
      const loc = (job.city ?? job.location ?? '').toLowerCase();
      const jobType = (job.jobType ?? '').toLowerCase();
      let score = 0;

      if (roles.some((r) => title.includes(r) || r.split(/\s+/).some((w) => title.includes(w)))) {
        score += 4;
      }
      if (skills.some((s) => title.includes(s) || desc.includes(s))) {
        score += 3;
      }
      if (locations.some((l) => loc.includes(l) || l.includes(loc.split(',')[0]?.trim() ?? ''))) {
        score += 2;
      }
      if (jobType.includes('remote') && (profile.workPreference ?? '').toLowerCase() === 'remote') {
        score += 2;
      }

      return { job, score };
    });

    const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    if (relevant.length >= 3) {
      return relevant.map((s) => s.job);
    }

    const keywordHits = new Set<CareerJob>();
    for (const kw of this.getProfileSearchKeywords(profile)) {
      for (const job of this.searchByKeyword(jobs, kw)) {
        keywordHits.add(job);
      }
    }
    if (keywordHits.size >= 3) {
      return [...keywordHits];
    }

    return jobs;
  }

  private asArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
}
