import { Injectable } from '@nestjs/common';
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
    // If any non-seed real jobs exist, skip seeding entirely.
    const realCount = await this.prisma.careerJob.count({
      where: { userId, source: { not: 'seed' } },
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

  searchByKeyword(
    jobs: Awaited<ReturnType<CareerJobService['listActive']>>,
    keyword: string,
  ) {
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
}
