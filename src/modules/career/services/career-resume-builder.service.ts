import { Injectable } from '@nestjs/common';
import { CareerProfile } from '@prisma/client';

interface JobContext {
  title: string;
  company: string;
  description?: string | null;
}

/**
 * Builds production-quality resume/cover letter text from structured profile data
 * when AI output is missing or too thin. Never invents employers or degrees.
 */
@Injectable()
export class CareerResumeBuilderService {
  /** Minimum viable tailored resume — must have substance beyond a name line. */
  isResumeContentValid(content: string | null | undefined): boolean {
    if (!content?.trim()) {
      return false;
    }
    const text = content.trim();
    if (text.length < 280) {
      return false;
    }
    const lower = text.toLowerCase();
    const hasExperience = /experience|work history|employment/i.test(lower);
    const hasSkills = /skills|technical/i.test(lower);
    const hasEducation = /education|qualification|degree/i.test(lower);
    return (hasExperience || hasSkills) && (hasSkills || hasEducation || hasExperience);
  }

  ensureTailoredResume(
    aiContent: string | null | undefined,
    profile: Record<string, unknown>,
    originalResumeText: string,
    job: JobContext,
  ): string {
    if (this.isResumeContentValid(aiContent)) {
      return aiContent!.trim();
    }
    return this.buildTailoredResume(profile, originalResumeText, job);
  }

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

  buildTailoredResume(
    profile: Record<string, unknown>,
    originalResumeText: string,
    job: JobContext,
  ): string {
    const name = String(profile.full_name ?? 'Candidate').trim();
    const phone = String(profile.phone ?? '').trim();
    const email = String(profile.email ?? '').trim();
    const location = String(profile.current_location ?? '').trim();
    const skills = this.asStringArray(profile.skills);
    const experience = this.asExperience(profile.experience);
    const education = this.asEducation(profile.education);
    const jobKeywords = this.extractJobKeywords(job);

    const orderedSkills = this.orderSkillsForJob(skills, jobKeywords);
    const summary = this.buildSummary(name, experience, orderedSkills, job);
    const experienceBlock = this.formatExperience(experience, originalResumeText);
    const educationBlock = this.formatEducation(education, originalResumeText);

    const contactParts = [name, phone, email, location].filter(Boolean);
    const sections: string[] = [
      'CONTACT',
      contactParts.join(' | '),
      '',
      'PROFESSIONAL SUMMARY',
      summary,
      '',
      'SKILLS',
      orderedSkills.length > 0 ? orderedSkills.join(', ') : this.extractSkillHints(originalResumeText).join(', '),
      '',
      'EXPERIENCE',
      experienceBlock || this.extractExperienceExcerpt(originalResumeText),
      '',
      'EDUCATION',
      educationBlock || this.extractEducationExcerpt(originalResumeText),
    ];

    const certs = this.asStringArray(profile.certifications);
    if (certs.length > 0) {
      sections.push('', 'CERTIFICATIONS', certs.join(', '));
    }

    return sections.filter((line, i, arr) => line !== '' || (arr[i + 1] ?? '') !== '').join('\n').trim();
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

  private buildSummary(
    name: string,
    experience: Array<{ title?: string; company?: string; years?: string; summary?: string }>,
    skills: string[],
    job: JobContext,
  ): string {
    const latest = experience[0];
    const skillSnippet = skills.slice(0, 5).join(', ');
    const rolePhrase = latest?.title ? `${latest.title}${latest.company ? ` at ${latest.company}` : ''}` : 'professional experience';
    const years = latest?.years ? `${latest.years}+ years of ` : '';

    return [
      `${name} is a ${years}results-driven professional with ${rolePhrase}.`,
      skillSnippet
        ? `Core strengths include ${skillSnippet}, with a focus on delivering value in ${job.title} roles.`
        : `Background aligns with ${job.title} responsibilities at ${job.company}.`,
      latest?.summary?.trim() ||
        `Seeking to apply proven expertise to the ${job.title} opportunity at ${job.company}.`,
    ].join(' ');
  }

  private formatExperience(
    experience: Array<{ title?: string; company?: string; years?: string; summary?: string }>,
    originalText: string,
  ): string {
    if (experience.length === 0) {
      return '';
    }

    return experience
      .map((entry) => {
        const header = [entry.title, entry.company, entry.years ? `(${entry.years} years)` : '']
          .filter(Boolean)
          .join(' — ');
        const bullets = entry.summary
          ? entry.summary
              .split(/[•\n;]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => `• ${s}`)
              .join('\n')
          : '';
        return [header, bullets].filter(Boolean).join('\n');
      })
      .join('\n\n');
  }

  private formatEducation(
    education: Array<{ degree?: string; institution?: string; year?: string }>,
    originalText: string,
  ): string {
    if (education.length === 0) {
      return '';
    }
    return education
      .map((e) => [e.degree, e.institution, e.year].filter(Boolean).join(' — '))
      .join('\n');
  }

  private extractExperienceExcerpt(originalText: string): string {
    const match = originalText.match(
      /(?:experience|employment|work history)[\s\S]{0,3500}/i,
    );
    if (match) {
      return this.cleanExcerpt(match[0], 2500);
    }
    return this.cleanExcerpt(originalText, 2000);
  }

  private extractEducationExcerpt(originalText: string): string {
    const match = originalText.match(/(?:education|qualification|academic)[\s\S]{0,1200}/i);
    return match ? this.cleanExcerpt(match[0], 800) : 'See uploaded resume for education details.';
  }

  private extractSkillHints(text: string): string[] {
    const common = [
      'react', 'node', 'javascript', 'typescript', 'python', 'java', 'sql', 'aws',
      'docker', 'kubernetes', 'angular', 'vue', 'laravel', 'php', 'mysql', 'postgresql',
      'sales', 'marketing', 'accounting', 'excel', 'communication', 'leadership',
    ];
    const lower = text.toLowerCase();
    return common.filter((s) => lower.includes(s));
  }

  private extractJobKeywords(job: JobContext): string[] {
    const blob = `${job.title} ${job.description ?? ''}`.toLowerCase();
    return blob
      .split(/[^a-z0-9+#/.-]+/)
      .filter((w) => w.length > 2)
      .slice(0, 40);
  }

  private orderSkillsForJob(skills: string[], jobKeywords: string[]): string[] {
    if (skills.length === 0) {
      return [];
    }
    const score = (skill: string) => {
      const s = skill.toLowerCase();
      return jobKeywords.some((k) => s.includes(k) || k.includes(s)) ? 1 : 0;
    };
    return [...skills].sort((a, b) => score(b) - score(a));
  }

  private cleanExcerpt(text: string, maxLen: number): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
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

  private asEducation(raw: unknown): Array<{ degree?: string; institution?: string; year?: string }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((e) => ({
      degree: (e as any)?.degree,
      institution: (e as any)?.institution,
      year: (e as any)?.year,
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
