import { Injectable } from '@nestjs/common';
import { CareerJob, CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JobMatchResult {
  job: CareerJob;
  score: number;
  matchFactors: string[];
  missingSkills: string[];
}

/**
 * Scoring weights — must sum to 100.
 *
 *  Skills       40 pts  — primary technical fit signal
 *  Experience   20 pts  — years vs job minimum requirement
 *  Salary       15 pts  — candidate expectation vs job range
 *  Location     15 pts  — preferred locations vs job city / remote flag
 *  Role title   10 pts  — preferred roles vs job title
 */
const W_SKILLS     = 40;
const W_EXPERIENCE = 20;
const W_SALARY     = 15;
const W_LOCATION   = 15;
const W_ROLE       = 10;

@Injectable()
export class CareerMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  matchProfileToJobs(profile: CareerProfile, jobs: CareerJob[]): JobMatchResult[] {
    const profileSkills    = this.normalizeSkills(profile.skills);
    const preferredRoles   = this.normalizeArray(profile.preferredRoles);
    const preferredLocs    = this.normalizeArray(profile.preferredLocations).map((l) => l.toLowerCase());
    const profileExpYears  = this.calcExperienceYears(profile.experience);
    const expectedSalaryL  = this.parseSalaryLPA(profile.expectedSalary);
    const workPref         = (profile.workPreference ?? '').toLowerCase();

    return jobs
      .map((job) => {
        const matched: string[] = [];
        const missing: string[]  = [];
        let score = 0;

        // ── 1. Skills (40 pts) ───────────────────────────────────────────────
        const required = this.normalizeSkills(job.requiredSkills);
        if (required.length > 0) {
          const hits = required.filter((skill) =>
            profileSkills.some((ps) => ps.includes(skill) || skill.includes(ps)),
          );
          score += (hits.length / required.length) * W_SKILLS;
          hits.forEach((s) => matched.push(`✓ ${this.cap(s)}`));
          required.filter((s) => !hits.includes(s)).forEach((s) => missing.push(this.cap(s)));
        } else {
          // No required skills listed — award half credit so the job still appears.
          score += W_SKILLS * 0.5;
        }

        // ── 2. Experience (20 pts) ───────────────────────────────────────────
        const minExp = job.minExperience ?? 0;
        if (profileExpYears >= minExp) {
          score += W_EXPERIENCE;
          matched.push(`✓ ${profileExpYears}y exp (min ${minExp}y)`);
        } else if (minExp > 0) {
          // Partial credit proportional to how close the candidate is.
          const partial = (profileExpYears / minExp) * W_EXPERIENCE * 0.6;
          score += partial;
          missing.push(`${minExp}+ years experience`);
        }

        // ── 3. Salary (15 pts) ───────────────────────────────────────────────
        const jobMinL = this.inrToLPA(job.salaryMin);
        const jobMaxL = this.inrToLPA(job.salaryMax);

        if (expectedSalaryL !== null && jobMinL !== null && jobMaxL !== null) {
          if (expectedSalaryL >= jobMinL && expectedSalaryL <= jobMaxL * 1.15) {
            // Expectation falls within range (with 15% headroom for negotiation).
            score += W_SALARY;
            matched.push(`✓ Salary fits (expect ${expectedSalaryL}L, range ${jobMinL}–${jobMaxL}L)`);
          } else if (expectedSalaryL <= jobMaxL) {
            // Expectation is below max — candidate may accept.
            score += W_SALARY * 0.7;
            matched.push(`✓ Within salary budget`);
          } else {
            // Candidate expects more than the job offers.
            missing.push(`Salary: expect ${expectedSalaryL}L, offered up to ${jobMaxL}L`);
          }
        } else {
          // Salary data missing on one side — neutral half credit.
          score += W_SALARY * 0.5;
        }

        // ── 4. Location (15 pts) ─────────────────────────────────────────────
        const jobCity   = ((job as any).city ?? job.location ?? '').toLowerCase();
        const jobType   = (job.jobType ?? '').toLowerCase();
        const isRemote  = jobType.includes('remote') || jobCity.includes('remote');

        if (workPref === 'remote' && isRemote) {
          score += W_LOCATION;
          matched.push('✓ Remote role');
        } else if (workPref === 'remote' && !isRemote) {
          // Candidate wants remote, job is not.
          missing.push('Remote role required');
        } else if (preferredLocs.length > 0) {
          const locHit = preferredLocs.some(
            (loc) =>
              jobCity.includes(loc) ||
              loc.includes(jobCity.split(' ')[0]),   // "Bangalore" matches "Bengaluru, Karnataka"
          );
          if (locHit) {
            score += W_LOCATION;
            matched.push(`✓ Location matches`);
          } else if (isRemote) {
            // Remote is acceptable even when not the preference.
            score += W_LOCATION * 0.6;
            matched.push('✓ Remote option (not preferred city)');
          } else {
            missing.push(`Location: prefers ${preferredLocs.slice(0, 2).join(' / ')}`);
          }
        } else {
          // No location preference stated — half credit.
          score += W_LOCATION * 0.5;
        }

        // ── 5. Role title (10 pts) ───────────────────────────────────────────
        if (preferredRoles.length > 0) {
          const jobTitleLower = job.title.toLowerCase();

          // Word-boundary match: "react" should not match "react native" as a full hit.
          const roleHit = preferredRoles.some((r) => {
            const roleLower = r.toLowerCase();
            // Exact containment in either direction on word tokens.
            const roleWords = roleLower.split(/\s+/);
            const titleWords = jobTitleLower.split(/\s+/);
            return (
              titleWords.some((tw) => roleWords.includes(tw)) ||
              roleWords.some((rw) => titleWords.includes(rw))
            );
          });

          if (roleHit) {
            score += W_ROLE;
            matched.push('✓ Preferred role match');
          }
        } else {
          // No role preference — half credit.
          score += W_ROLE * 0.5;
        }

        return {
          job,
          score: Math.min(100, Math.round(score)),
          matchFactors: matched,
          missingSkills: missing,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Upserts all match results in a single transaction.
   * Previous implementation ran N individual upsert calls sequentially — with 200
   * Adzuna jobs per tenant that was 200 sequential DB round-trips per match run.
   * This version batches the work inside a $transaction for a single DB round-trip.
   */
  async persistMatches(
    userId: number,
    profileId: number,
    contactId: number,
    results: JobMatchResult[],
  ): Promise<void> {
    const top = results.slice(0, 100);
    if (top.length === 0) return;

    await this.prisma.$transaction(
      top.map((r) =>
        this.prisma.careerJobMatch.upsert({
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
        }),
      ),
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Reads the `years` or `duration` field that the AI extracts from each
   * experience entry. Falls back to 1 year per entry when the field is absent
   * or not parseable. Caps the total at 35 years.
   */
  private calcExperienceYears(experience: unknown): number {
    if (!Array.isArray(experience) || experience.length === 0) return 0;
    let total = 0;
    for (const entry of experience) {
      const raw = String((entry as any)?.years ?? (entry as any)?.duration ?? '');
      const n = parseFloat(raw.replace(/[^\d.]/g, ''));
      total += isNaN(n) ? 1 : Math.min(n, 20);
    }
    return Math.min(total > 0 ? total : experience.length, 35);
  }

  /**
   * Parses salary strings like "10 LPA", "10L", "10 lakh", "10-15 LPA" (takes lower
   * bound), "800000" (raw INR), into a LPA float.  Returns null when not parseable.
   */
  private parseSalaryLPA(raw: string | null | undefined): number | null {
    if (!raw) return null;
    const match = raw.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const n = parseFloat(match[1]);
    if (isNaN(n)) return null;
    // If the number is > 1000 it is likely raw rupees — convert to LPA.
    return n > 1000 ? Math.round(n / 100_000 * 10) / 10 : n;
  }

  /**
   * Converts a salary stored in the DB (could be raw INR or already LPA) to LPA.
   * Returns null when the input is null / 0.
   */
  private inrToLPA(inr: number | null | undefined): number | null {
    if (!inr) return null;
    return inr > 1000 ? Math.round(inr / 100_000 * 10) / 10 : inr;
  }

  private normalizeSkills(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  }

  private normalizeArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

  private cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
