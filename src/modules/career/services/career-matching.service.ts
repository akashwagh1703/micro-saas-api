import { Injectable } from '@nestjs/common';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JobMatchResult {
  job: CareerJob;
  score: number;
  matchFactors: string[];
  missingSkills: string[];
}

@Injectable()
export class CareerMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  matchProfileToJobs(profile: CareerProfile, jobs: CareerJob[]): JobMatchResult[] {
    const profileSkills = this.normalizeSkills(profile.skills);
    const preferredRoles = this.normalizeArray(profile.preferredRoles);
    const profileExpYears = this.estimateExperienceYears(profile.experience);

    return jobs
      .map((job) => {
        const required = this.normalizeSkills(job.requiredSkills);
        const matched: string[] = [];
        const missing: string[] = [];

        for (const skill of required) {
          if (profileSkills.some((s) => s.includes(skill) || skill.includes(s))) {
            matched.push(`✓ ${this.capitalize(skill)} matches`);
          } else {
            missing.push(this.capitalize(skill));
          }
        }

        let score = required.length > 0 ? (matched.length / required.length) * 70 : 50;

        if (preferredRoles.length > 0) {
          const roleHit = preferredRoles.some(
            (r) =>
              job.title.toLowerCase().includes(r.toLowerCase()) ||
              r.toLowerCase().includes(job.title.toLowerCase()),
          );
          if (roleHit) {
            score += 15;
            matched.push('✓ Preferred role matches');
          }
        }

        if (job.minExperience != null && profileExpYears >= job.minExperience) {
          score += 10;
          matched.push('✓ Experience matches');
        } else if (job.minExperience != null) {
          missing.push(`${job.minExperience}+ years experience`);
        }

        if (profile.workPreference && job.jobType) {
          const pref = profile.workPreference.toLowerCase();
          const jt = job.jobType.toLowerCase();
          if (pref === jt || (pref === 'remote' && jt.includes('remote'))) {
            score += 5;
            matched.push('✓ Job type matches');
          }
        }

        score = Math.min(100, Math.round(score));

        return {
          job,
          score,
          matchFactors: matched,
          missingSkills: missing,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  async persistMatches(
    userId: number,
    profileId: number,
    contactId: number,
    results: JobMatchResult[],
  ): Promise<void> {
    for (const r of results.slice(0, 50)) {
      await this.prisma.careerJobMatch.upsert({
        where: { profileId_jobId: { profileId, jobId: r.job.id } },
        create: {
          userId,
          profileId,
          contactId,
          jobId: r.job.id,
          score: r.score,
          matchFactors: r.matchFactors,
          missingSkills: r.missingSkills,
        },
        update: {
          score: r.score,
          matchFactors: r.matchFactors,
          missingSkills: r.missingSkills,
        },
      });
    }
  }

  private normalizeSkills(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    }
    return [];
  }

  private normalizeArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

  private estimateExperienceYears(experience: unknown): number {
    if (!Array.isArray(experience) || experience.length === 0) return 0;
    let total = 0;
    for (const entry of experience) {
      // Use the 'years' or 'duration' field the AI extracts; fall back to 1 per entry.
      const raw = String((entry as any)?.years ?? (entry as any)?.duration ?? '');
      const n = parseFloat(raw.replace(/[^\d.]/g, ''));
      total += isNaN(n) ? 1 : Math.min(n, 20);
    }
    return Math.min(total > 0 ? total : experience.length, 35);
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
