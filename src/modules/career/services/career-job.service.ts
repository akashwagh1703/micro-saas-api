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
  },
];

@Injectable()
export class CareerJobService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSampleJobs(userId: number): Promise<number> {
    const count = await this.prisma.careerJob.count({ where: { userId } });
    if (count > 0) {
      return count;
    }

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
          source: 'seed',
        },
      });
    }

    return SAMPLE_JOBS.length;
  }

  async listActive(userId: number) {
    return this.prisma.careerJob.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  searchByKeyword(jobs: Awaited<ReturnType<CareerJobService['listActive']>>, keyword: string) {
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
