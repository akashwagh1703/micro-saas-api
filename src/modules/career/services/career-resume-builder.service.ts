import { Injectable } from '@nestjs/common';
import { CareerProfile } from '@prisma/client';

interface JobContext {
  title: string;
  company: string;
  description?: string | null;
}

/**
 * Builds production-quality cover letter text from structured profile data
 * when AI output is missing or too thin. Never invents employers or degrees.
 */
@Injectable()
export class CareerResumeBuilderService {
  ensureCoverLetter(
    aiContent: string | null | undefined,
    profile: Record<string, unknown>,
    originalResumeText: string,
    job: JobContext,
  ): string {
    if (aiContent?.trim() && aiContent.trim().length >= 180) {
      return aiContent.trim();
    }
    return this.buildCoverLetter(profile, originalResumeText, job);
  }

  buildCoverLetter(
    profile: Record<string, unknown>,
    originalResumeText: string,
    job: JobContext,
  ): string {
    const name = String(profile.full_name ?? 'Candidate').trim();
    const location = String(profile.current_location ?? '').trim();
    const notice = String(profile.notice_period ?? '').trim();
    const skills = this.asStringArray(profile.skills);
    const experience = this.asExperience(profile.experience);
    const latest = experience[0];
    const skillLine = skills.slice(0, 6).join(', ');

    const expLine = latest
      ? `In my recent role as ${latest.title ?? 'a professional'}${latest.company ? ` at ${latest.company}` : ''}, ${latest.summary?.trim() || 'I delivered measurable results aligned with business goals.'}`
      : this.firstMeaningfulSentence(originalResumeText) ||
        'My background aligns closely with the requirements outlined in your job description.';

    const paragraphs = [
      `Dear Hiring Manager,`,
      '',
      `I am writing to apply for the ${job.title} position at ${job.company}. With hands-on experience and skills including ${skillLine || 'relevant technical and professional capabilities'}, I am confident I can contribute effectively to your team.`,
      '',
      expLine,
      '',
      location
        ? `I am based in ${location}${notice ? ` and available to join after ${notice}` : ''}. I would welcome the opportunity to discuss how my experience supports your goals for this role.`
        : `I would welcome the opportunity to discuss how my experience supports your goals for this role.`,
      '',
      'Thank you for your consideration.',
      '',
      `Sincerely,\n${name}`,
    ];

    return paragraphs.join('\n');
  }

  formatParsedSummary(profile: CareerProfile): string {
    const lines: string[] = [];
    if (profile.fullName) {
      lines.push(`Name: ${profile.fullName}`);
    }
    if (profile.currentLocation) {
      lines.push(`Location: ${profile.currentLocation}`);
    }
    const roles = this.asStringArray(profile.preferredRoles);
    if (roles.length > 0) {
      lines.push(`Target roles: ${roles.slice(0, 3).join(', ')}`);
    }
    const skills = this.asStringArray(profile.skills);
    if (skills.length > 0) {
      lines.push(`Skills: ${skills.slice(0, 8).join(', ')}`);
    }
    const expYears = this.totalExperienceYears(profile.experience);
    if (expYears > 0) {
      lines.push(`Experience: ~${expYears} years`);
    }
    if (profile.expectedSalary) {
      lines.push(`Expected salary: ${profile.expectedSalary}`);
    }
    return lines.join('\n');
  }

  private firstMeaningfulSentence(text: string): string | null {
    const sentence = text.replace(/\s+/g, ' ').match(/[^.!?]{40,200}[.!?]/);
    return sentence?.[0]?.trim() ?? null;
  }

  private asStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

  private asExperience(raw: unknown): Array<{ title?: string; company?: string; years?: string; summary?: string }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((e) => ({
      title: (e as any)?.title,
      company: (e as any)?.company,
      years: (e as any)?.years,
      summary: (e as any)?.summary,
    }));
  }

  private totalExperienceYears(experience: unknown): number {
    const entries = this.asExperience(experience);
    if (entries.length === 0) {
      return 0;
    }
    let total = 0;
    for (const entry of entries) {
      const n = parseFloat(String(entry.years ?? '').replace(/[^\d.]/g, ''));
      total += Number.isNaN(n) ? 1 : Math.min(n, 20);
    }
    return Math.min(total || entries.length, 35);
  }
}
