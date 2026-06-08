import { Injectable } from '@nestjs/common';
import { AiService, AiResult } from '../../integrations/ai.service';
import { CareerAiUsageService } from './career-ai-usage.service';

export interface ParsedCareerProfile {
  full_name?: string;
  email?: string;
  phone?: string;
  skills?: string[];
  experience?: Array<{ title?: string; company?: string; years?: string; summary?: string }>;
  education?: Array<{ degree?: string; institution?: string; year?: string }>;
  certifications?: string[];
  projects?: string[];
  languages?: string[];
  current_location?: string;
  preferred_locations?: string[];
  current_salary?: string;
  expected_salary?: string;
  notice_period?: string;
  work_preference?: string;
  preferred_roles?: string[];
}

export type ConvTurn = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class CareerAiService {
  constructor(
    private readonly ai: AiService,
    private readonly usage: CareerAiUsageService,
  ) {}

  // ─── Resume parsing ───────────────────────────────────────────────────────────

  async parseResume(userId: number, resumeText: string): Promise<ParsedCareerProfile | null> {
    if (!(await this.usage.isWithinLimit(userId)).allowed) {
      return null;
    }

    const result1 = await this.ai.complete(userId, this.buildParsePrompt(resumeText), {
      max_tokens: 2500,
      temperature: 0.1,
    });
    await this.track(userId, 'parse_resume', result1);
    if (result1.success && result1.content) {
      const parsed = this.parseJson(result1.content);
      if (parsed) return parsed;
    }

    const result2 = await this.ai.complete(userId, this.buildFallbackParsePrompt(resumeText), {
      max_tokens: 1200,
      temperature: 0.1,
    });
    await this.track(userId, 'parse_resume_fallback', result2);
    if (result2.success && result2.content) {
      return this.parseJson(result2.content);
    }

    return null;
  }

  // ─── Tailored resume ──────────────────────────────────────────────────────────

  async generateTailoredResume(
    userId: number,
    profile: Record<string, unknown>,
    job: { title: string; company: string; description?: string | null },
    originalResumeText: string,
  ): Promise<string | null> {
    if (!originalResumeText.trim()) {
      return null;
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You tailor an EXISTING resume for a specific job application. ' +
          'CRITICAL RULES:\n' +
          '1. Use ONLY facts from the candidate\'s original resume text and profile — never invent employers, job titles, dates, degrees, certifications, or skills.\n' +
          '2. Do NOT add experience, projects, or qualifications that are not in the source resume.\n' +
          '3. You MAY reword bullet points, reorder sections, and mirror keywords from the job description when they honestly describe existing experience.\n' +
          '4. You MAY write a short professional summary that reframes their real background for this role.\n' +
          '5. Return plain text only with section headers: CONTACT | PROFESSIONAL SUMMARY | SKILLS | EXPERIENCE | EDUCATION | CERTIFICATIONS',
      },
      {
        role: 'user',
        content: [
          `Tailor this candidate's resume for: ${job.title} at ${job.company}`,
          '',
          '--- TARGET JOB ---',
          `Title: ${job.title}`,
          `Company: ${job.company}`,
          `Description: ${(job.description ?? 'N/A').slice(0, 2500)}`,
          '',
          '--- CANDIDATE PROFILE (structured) ---',
          JSON.stringify(profile).slice(0, 4000),
          '',
          '--- ORIGINAL RESUME (source of truth — do not add facts beyond this) ---',
          originalResumeText.slice(0, 12000),
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 3000,
      temperature: 0.2,
    });
    await this.track(userId, 'generate_resume', result);
    return result.success ? (result.content ?? null) : null;
  }

  // ─── Cover letter ─────────────────────────────────────────────────────────────

  async generateCoverLetter(
    userId: number,
    profile: Record<string, unknown>,
    job: { title: string; company: string; description?: string | null },
    originalResumeText: string,
  ): Promise<string | null> {
    if (!originalResumeText.trim()) {
      return null;
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You write cover letters based ONLY on the candidate\'s real resume and profile. ' +
          'Never invent employers, achievements, degrees, or skills. ' +
          'Reference specific real experience from their resume that matches the job. ' +
          'Under 350 words. Plain text only — paragraphs separated by blank lines. No markdown.',
      },
      {
        role: 'user',
        content: [
          `Write a cover letter for ${(profile['full_name'] as string) ?? 'the candidate'} applying to ${job.title} at ${job.company}.`,
          '',
          '--- TARGET JOB ---',
          `Description: ${(job.description ?? 'N/A').slice(0, 2000)}`,
          '',
          '--- CANDIDATE PROFILE ---',
          JSON.stringify({
            full_name: profile['full_name'],
            skills: profile['skills'],
            experience: profile['experience'],
            education: profile['education'],
            current_location: profile['current_location'],
          }).slice(0, 3000),
          '',
          '--- ORIGINAL RESUME (only cite facts from here) ---',
          originalResumeText.slice(0, 10000),
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 1000,
      temperature: 0.35,
    });
    await this.track(userId, 'generate_cover_letter', result);
    return result.success ? (result.content ?? null) : null;
  }

  // ─── Career advice with conversation history ──────────────────────────────────

  async careerAdvice(
    userId: number,
    question: string,
    profile: Record<string, unknown>,
    history: ConvTurn[] = [],
  ): Promise<string> {
    const systemMsg = [
      'You are CareerAI — a professional career coach responding on WhatsApp.',
      'Be concise (max 250 words), warm, specific, and actionable.',
      'Reference the candidate\'s actual skills and experience in your answers.',
      'Candidate profile:',
      JSON.stringify({
        name: profile['full_name'],
        skills: profile['skills'],
        experience: profile['experience'],
        current_location: profile['current_location'],
        preferred_roles: profile['preferred_roles'],
      }).slice(0, 2500),
    ].join(' ');

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemMsg },
      // Include last 10 turns (5 exchanges) for context.
      ...history.slice(-10),
      { role: 'user', content: question },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, { max_tokens: 500 });
    await this.track(userId, 'career_advice', result);
    return result.content ?? 'I could not generate advice right now. Try again in a moment.';
  }

  // ─── Interview prep ───────────────────────────────────────────────────────────

  async interviewPrep(
    userId: number,
    role: string,
    profile: Record<string, unknown>,
  ): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are an interview coach on WhatsApp. ' +
          'Format answers for easy reading on mobile. Use bullet points. ' +
          'Keep the total response under 400 words.',
      },
      {
        role: 'user',
        content: [
          `Prepare an interview guide for a *${role}* role.`,
          'Include:',
          '1. 5 most likely interview questions with short sample answers',
          '2. 3 smart questions the candidate should ask the interviewer',
          '3. One specific tip based on the candidate\'s background',
          '',
          `Candidate background: ${JSON.stringify({
            skills: profile['skills'],
            experience: profile['experience'],
          }).slice(0, 2000)}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 700,
      temperature: 0.5,
    });
    await this.track(userId, 'interview_prep', result);
    return result.content ?? 'Interview prep unavailable. Try again later.';
  }

  // ─── Resume improvement ───────────────────────────────────────────────────────

  async improveResume(
    userId: number,
    section: string,
    profile: Record<string, unknown>,
  ): Promise<string> {
    const sectionKey = section.toLowerCase().trim();
    // Map common user inputs to the correct profile key.
    const keyMap: Record<string, string> = {
      experience: 'experience',
      exp: 'experience',
      skills: 'skills',
      skill: 'skills',
      education: 'education',
      edu: 'education',
      projects: 'projects',
      project: 'projects',
      summary: 'experience',
      certifications: 'certifications',
      certs: 'certifications',
    };
    const profileKey = keyMap[sectionKey] ?? 'experience';
    const sectionData = profile[profileKey];

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a resume improvement coach on WhatsApp. ' +
          'Give 3 specific, actionable improvements. ' +
          'Show a before/after example for the most impactful suggestion. ' +
          'Keep the total under 250 words.',
      },
      {
        role: 'user',
        content: [
          `Review the "${profileKey}" section of this resume and suggest improvements.`,
          '',
          `Current content: ${JSON.stringify(sectionData).slice(0, 2000)}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 500,
      temperature: 0.4,
    });
    await this.track(userId, 'improve_resume', result);
    return result.content ?? 'Could not generate suggestions right now. Try again shortly.';
  }

  async salaryBenchmark(
    userId: number,
    profile: Record<string, unknown>,
  ): Promise<string> {
    const roles = (profile.preferred_roles as string[] | undefined)?.join(', ') || 'your target role';
    const location = profile.current_location || profile.preferred_locations || 'India';

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a salary research coach for Indian job markets. Give realistic LPA ranges for 2025–2026. ' +
          'Be concise (under 200 words). Include junior/mid/senior bands when relevant. Plain text only.',
      },
      {
        role: 'user',
        content: [
          `Estimate market salary benchmark for: ${roles}`,
          `Location / preference: ${JSON.stringify(location)}`,
          `Experience snapshot: ${JSON.stringify(profile.experience ?? []).slice(0, 1500)}`,
          `Current salary: ${profile.current_salary ?? 'not stated'}`,
          `Expected salary: ${profile.expected_salary ?? 'not stated'}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 450,
      temperature: 0.3,
    });
    await this.track(userId, 'salary_benchmark', result);
    return result.content ?? 'Salary benchmark unavailable right now. Try again later.';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async track(userId: number, context: string, result: AiResult): Promise<void> {
    if (result.usage) {
      await this.usage.record(userId, context, result.usage);
    }
  }

  private buildParsePrompt(resumeText: string): string {
    return [
      'You are a precise resume parser. Return ONLY a JSON object — no explanation, no markdown fences.',
      '',
      'Use this exact schema. Use empty arrays [] for missing sections. ' +
        'For experience, always include a "years" field with the number of years (e.g. "2").',
      '',
      '{"full_name":"","email":"","phone":"","skills":["React","Node.js"],' +
        '"experience":[{"title":"Software Engineer","company":"Acme","years":"3","summary":"Built REST APIs"}],' +
        '"education":[{"degree":"B.Tech","institution":"IIT Mumbai","year":"2020"}],' +
        '"certifications":["AWS Certified"],"projects":["E-commerce platform"],"languages":["English","Hindi"],' +
        '"current_location":"Mumbai","preferred_locations":["Pune","Remote"],' +
        '"current_salary":"8 LPA","expected_salary":"12 LPA","notice_period":"30 days",' +
        '"work_preference":"Hybrid","preferred_roles":["React Developer","Full Stack Engineer"]}',
      '',
      'Resume text:',
      // Increased from 12,000 to 14,000 chars to capture more of multi-page resumes.
      resumeText.slice(0, 14000),
    ].join('\n');
  }

  private buildFallbackParsePrompt(resumeText: string): string {
    return [
      'Extract ONLY skills and experience from this resume. Return JSON only.',
      '',
      'Schema: {"skills":["React"],"experience":[{"title":"Developer","company":"Acme","years":"3","summary":""}]}',
      '',
      resumeText.slice(0, 8000),
    ].join('\n');
  }

  private parseJson(raw: string): ParsedCareerProfile | null {
    // Strip markdown code fences if the model added them despite instructions.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as ParsedCareerProfile;
    } catch {
      return null;
    }
  }
}
