import { Injectable } from '@nestjs/common';
import { AiService, AiResult } from '../../integrations/ai.service';
import {
  CareerRoadmapData,
  CertificationRecData,
  SalaryInsightData,
  SkillGapPlanData,
} from '../career-guidance-state.util';
import { ParsedCareerProfile } from '../career-parsed-profile.types';
import { normalizeRawAiParse } from '../career-resume-parse.util';
import { CareerAiUsageService } from './career-ai-usage.service';

export type { ParsedCareerProfile } from '../career-parsed-profile.types';
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

    const structuredHint = this.buildStructuredResumeHint(resumeText);

    const result1 = await this.ai.complete(userId, this.buildParsePrompt(resumeText, structuredHint), {
      max_tokens: 3500,
      temperature: 0.05,
    });
    await this.track(userId, 'parse_resume', result1);
    if (result1.success && result1.content) {
      const parsed = this.parseJson(result1.content);
      if (parsed) {
        return normalizeRawAiParse(parsed) ?? parsed;
      }
    }

    const result2 = await this.ai.complete(userId, this.buildFallbackParsePrompt(resumeText), {
      max_tokens: 2500,
      temperature: 0.05,
    });
    await this.track(userId, 'parse_resume_fallback', result2);
    if (result2.success && result2.content) {
      const parsed = this.parseJson(result2.content);
      if (parsed) {
        return normalizeRawAiParse(parsed) ?? parsed;
      }
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
          '5. Return plain text only with section headers: CONTACT | PROFESSIONAL SUMMARY | SKILLS | EXPERIENCE | EDUCATION | CERTIFICATIONS\n' +
          '6. Minimum length: at least 350 words. Every section must contain real content from the source resume — never leave sections empty.',
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

  /** Generates role-specific mock interview questions (JSON array). */
  async generateMockInterviewQuestions(
    userId: number,
    interviewType: string,
    role: string,
    profile: Record<string, unknown>,
    job?: { title: string; company: string; description?: string | null },
    count = 5,
  ): Promise<string[]> {
    const typeLabel = interviewType.replace(/_/g, ' ');
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You create realistic mock interview questions for Indian job seekers on WhatsApp. ' +
          `Return ONLY a JSON array of exactly ${count} strings — no markdown, no explanation.`,
      },
      {
        role: 'user',
        content: [
          `Create ${count} ${typeLabel} interview questions for a *${role}* role.`,
          job
            ? `Target job: ${job.title} at ${job.company}. Job description excerpt: ${(job.description ?? '').slice(0, 1200)}`
            : '',
          `Candidate skills: ${JSON.stringify(profile['skills'] ?? []).slice(0, 800)}`,
          `Experience: ${JSON.stringify(profile['experience'] ?? []).slice(0, 800)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 700,
      temperature: 0.55,
    });
    await this.track(userId, 'mock_interview_questions', result);

    const parsed = this.parseJsonArray(result.content ?? '');
    if (parsed.length >= count) {
      return parsed.slice(0, count);
    }

    return this.defaultMockQuestions(interviewType, role, count);
  }

  /** Scores one mock interview answer (0–100) with brief feedback. */
  async evaluateMockInterviewAnswer(
    userId: number,
    interviewType: string,
    role: string,
    question: string,
    answer: string,
    profile: Record<string, unknown>,
  ): Promise<{ score: number; feedback: string }> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You evaluate interview answers for WhatsApp. Return ONLY JSON: {"score":0-100,"feedback":"..."} ' +
          'Feedback: 2-4 sentences, constructive, specific. Score fairly for the role level.',
      },
      {
        role: 'user',
        content: [
          `Interview type: ${interviewType}`,
          `Role: ${role}`,
          `Question: ${question}`,
          `Candidate answer: ${answer.slice(0, 2500)}`,
          `Candidate background: ${JSON.stringify({
            skills: profile['skills'],
            experience: profile['experience'],
          }).slice(0, 1200)}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 350,
      temperature: 0.3,
    });
    await this.track(userId, 'mock_interview_eval', result);

    const parsed = this.parseEvalJson(result.content ?? '');
    if (parsed) {
      return {
        score: Math.min(100, Math.max(0, Math.round(parsed.score))),
        feedback: parsed.feedback || 'Good effort — add more specific examples next time.',
      };
    }

    return {
      score: 65,
      feedback: 'Thanks for your answer. Try adding a concrete example from your experience next time.',
    };
  }

  private defaultMockQuestions(type: string, role: string, count: number): string[] {
    const base: Record<string, string[]> = {
      hr: [
        `Tell me about yourself and why you want this ${role} role.`,
        'What are your salary expectations and notice period?',
        'Describe a challenging situation at work and how you handled it.',
        'Why are you leaving your current role?',
        'Where do you see yourself in 3 years?',
      ],
      technical: [
        `Walk me through your strongest technical skill relevant to ${role}.`,
        'Describe a project you built end-to-end and your specific contributions.',
        'How do you debug production issues under time pressure?',
        'Explain a technical decision you made that improved performance or reliability.',
        'What tools and technologies do you use daily in this domain?',
      ],
      behavioral: [
        'Tell me about a time you worked with a difficult teammate.',
        'Describe a situation where you had to meet a tight deadline.',
        'Give an example of when you took initiative without being asked.',
        'Tell me about a mistake you made and what you learned.',
        'Describe how you prioritize when everything seems urgent.',
      ],
      managerial: [
        'How do you mentor junior team members?',
        'Describe how you handle conflict within your team.',
        'Tell me about a time you delivered a project with limited resources.',
        'How do you align technical work with business goals?',
        'What is your approach to giving constructive feedback?',
      ],
    };
    return (base[type] ?? base.technical).slice(0, count);
  }

  private parseJsonArray(raw: string): string[] {
    const parsed = this.parseJson(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    if (parsed && Array.isArray((parsed as { questions?: unknown }).questions)) {
      return ((parsed as { questions: unknown[] }).questions)
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const arr = JSON.parse(match[0]) as unknown[];
        if (Array.isArray(arr)) {
          return arr.map((item) => String(item).trim()).filter(Boolean);
        }
      }
    } catch {
      // ignore
    }
    return [];
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

  // ─── Structured career guidance (Phase 4) ───────────────────────────────────

  async generateCareerRoadmap(
    userId: number,
    profile: Record<string, unknown>,
  ): Promise<CareerRoadmapData> {
    const roles = (profile.preferred_roles as string[] | undefined)?.join(', ') || 'your target role';
    const currentRole =
      this.inferCurrentRole(profile) ||
      (Array.isArray(profile.preferred_roles) ? String(profile.preferred_roles[0] ?? '') : '') ||
      'your current role';

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a career strategist for Indian tech and business roles. Return ONLY JSON with this schema: ' +
          '{"current_role":"...","steps":[{"role":"...","timeframe":"1-2 years","focus":"key skills"}],"summary":"2-3 sentences"} ' +
          'Provide 3-5 realistic ladder steps from current role toward preferred roles. Use Indian market context.',
      },
      {
        role: 'user',
        content: [
          `Current / inferred role: ${currentRole}`,
          `Target roles: ${roles}`,
          `Skills: ${JSON.stringify(profile.skills ?? []).slice(0, 1200)}`,
          `Experience: ${JSON.stringify(profile.experience ?? []).slice(0, 1500)}`,
          `Location: ${profile.current_location ?? 'India'}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 650,
      temperature: 0.35,
    });
    await this.track(userId, 'career_roadmap', result);

    const parsed = this.parseJsonObject(result.content ?? '');
    if (parsed) {
      const steps = Array.isArray(parsed.steps)
        ? parsed.steps
            .map((s: Record<string, unknown>) => ({
              role: String(s.role ?? '').trim(),
              timeframe: s.timeframe ? String(s.timeframe) : undefined,
              focus: s.focus ? String(s.focus) : undefined,
            }))
            .filter((s: { role: string }) => s.role)
        : [];

      return {
        currentRole: String(parsed.current_role ?? currentRole),
        steps,
        summary: String(parsed.summary ?? 'Focus on depth in your core stack, then broaden into leadership skills.'),
      };
    }

    return this.defaultRoadmap(currentRole, roles);
  }

  async generateSkillGapPlan(
    userId: number,
    profile: Record<string, unknown>,
    missingSkills: string[],
  ): Promise<SkillGapPlanData> {
    const targetRoles = (profile.preferred_roles as string[] | undefined)?.join(', ') || 'target roles';
    const skills = missingSkills.length > 0 ? missingSkills.slice(0, 12) : ['general upskilling'];

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a skills coach for job seekers in India. Return ONLY JSON: ' +
          '{"priorities":[{"skill":"...","why":"1 sentence","actions":["action1","action2"],"timeline":"2-3 months"}],"summary":"2 sentences"} ' +
          'Prioritize the top 4-6 skills. Actions must be practical and free/low-cost when possible.',
      },
      {
        role: 'user',
        content: [
          `Missing skills from top job matches: ${skills.join(', ')}`,
          `Target roles: ${targetRoles}`,
          `Current skills: ${JSON.stringify(profile.skills ?? []).slice(0, 1200)}`,
          `Experience: ${JSON.stringify(profile.experience ?? []).slice(0, 1200)}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 700,
      temperature: 0.35,
    });
    await this.track(userId, 'skill_gap_plan', result);

    const parsed = this.parseJsonObject(result.content ?? '');
    if (parsed && Array.isArray(parsed.priorities)) {
      const priorities = parsed.priorities
        .map((p: Record<string, unknown>) => ({
          skill: String(p.skill ?? '').trim(),
          why: String(p.why ?? '').trim(),
          actions: Array.isArray(p.actions) ? p.actions.map(String).filter(Boolean).slice(0, 4) : [],
          timeline: p.timeline ? String(p.timeline) : undefined,
        }))
        .filter((p: { skill: string }) => p.skill)
        .slice(0, 6);

      if (priorities.length > 0) {
        return {
          missingSkills: skills,
          priorities,
          summary: String(parsed.summary ?? 'Close the highest-impact skill gaps first to improve match scores.'),
        };
      }
    }

    return this.defaultSkillGap(skills);
  }

  async generateCertificationRecommendations(
    userId: number,
    profile: Record<string, unknown>,
    skillGaps: string[],
  ): Promise<CertificationRecData> {
    const roles = (profile.preferred_roles as string[] | undefined)?.join(', ') || 'your target role';
    const gaps = skillGaps.length > 0
      ? skillGaps.slice(0, 10)
      : (Array.isArray(profile.skills) ? profile.skills.map(String) : []).slice(0, 5);

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You recommend certifications for Indian job seekers. Return ONLY JSON: ' +
          '{"recommendations":[{"name":"...","provider":"...","skills":["..."],"reason":"1 sentence"}],"summary":"1-2 sentences"} ' +
          'Suggest 3-5 recognized certs (AWS, Azure, Google, PMI, Scrum, etc.) aligned to skill gaps. Prefer high ROI certs.',
      },
      {
        role: 'user',
        content: [
          `Skill gaps / focus areas: ${gaps.join(', ') || 'general professional growth'}`,
          `Target roles: ${roles}`,
          `Existing certs: ${JSON.stringify(profile.certifications ?? []).slice(0, 800)}`,
          `Skills: ${JSON.stringify(profile.skills ?? []).slice(0, 1000)}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 600,
      temperature: 0.35,
    });
    await this.track(userId, 'certification_recommendations', result);

    const parsed = this.parseJsonObject(result.content ?? '');
    if (parsed && Array.isArray(parsed.recommendations)) {
      const recommendations = parsed.recommendations
        .map((r: Record<string, unknown>) => ({
          name: String(r.name ?? '').trim(),
          provider: r.provider ? String(r.provider) : undefined,
          skills: Array.isArray(r.skills) ? r.skills.map(String).filter(Boolean) : [],
          reason: String(r.reason ?? '').trim(),
        }))
        .filter((r: { name: string }) => r.name)
        .slice(0, 5);

      if (recommendations.length > 0) {
        return {
          recommendations,
          summary: String(parsed.summary ?? 'Pick one certification aligned to your next role and commit for 2-3 months.'),
        };
      }
    }

    return this.defaultCertifications(gaps);
  }

  async generateSalaryInsight(
    userId: number,
    profile: Record<string, unknown>,
  ): Promise<SalaryInsightData> {
    const roles = (profile.preferred_roles as string[] | undefined)?.join(', ') || 'your target role';
    const location = String(profile.current_location ?? profile.preferred_locations ?? 'India');

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a salary research coach for Indian job markets (2025–2026 LPA). Return ONLY JSON: ' +
          '{"junior_range":"X-Y LPA","mid_range":"...","senior_range":"...","insight":"2-3 sentences","growth_tips":["tip1","tip2"]} ' +
          'Ranges must be realistic for the location and role.',
      },
      {
        role: 'user',
        content: [
          `Roles: ${roles}`,
          `Location: ${location}`,
          `Experience: ${JSON.stringify(profile.experience ?? []).slice(0, 1500)}`,
          `Current salary: ${profile.current_salary ?? 'not stated'}`,
          `Expected salary: ${profile.expected_salary ?? 'not stated'}`,
        ].join('\n'),
      },
    ];

    const result = await this.ai.completeWithMessages(userId, messages, {
      max_tokens: 450,
      temperature: 0.3,
    });
    await this.track(userId, 'salary_insight', result);

    const parsed = this.parseJsonObject(result.content ?? '');
    if (parsed) {
      return {
        roles,
        location,
        juniorRange: parsed.junior_range ? String(parsed.junior_range) : undefined,
        midRange: parsed.mid_range ? String(parsed.mid_range) : undefined,
        seniorRange: parsed.senior_range ? String(parsed.senior_range) : undefined,
        insight: String(parsed.insight ?? 'Salary varies by city, company tier, and niche skills.'),
        growthTips: Array.isArray(parsed.growth_tips)
          ? parsed.growth_tips.map(String).filter(Boolean).slice(0, 4)
          : undefined,
      };
    }

    const fallbackText = await this.salaryBenchmark(userId, profile);
    return {
      roles,
      location,
      insight: fallbackText,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async track(userId: number, context: string, result: AiResult): Promise<void> {
    if (result.usage) {
      await this.usage.record(userId, context, result.usage);
    }
  }

  private buildStructuredResumeHint(resumeText: string): string {
    const lines = resumeText.split('\n').map((l) => l.trim()).filter(Boolean);
    const preview = lines.slice(0, 15).join('\n');
    return [
      'Header preview (name is usually in first lines, NOT a job title):',
      preview,
    ].join('\n');
  }

  private buildParsePrompt(resumeText: string, structuredHint?: string): string {
    return [
      'You are an expert resume parser for Indian and international CVs. Return ONLY valid JSON — no markdown, no explanation.',
      '',
      'CRITICAL RULES:',
      '1. full_name = candidate PERSON name only (2-4 words). NEVER put a job title in full_name.',
      '2. preferred_roles = job titles the candidate wants or currently holds (from headline + experience). NEVER company names.',
      '3. skills = EVERY technical/professional skill, tool, framework, and language mentioned — be exhaustive.',
      '4. experience = ALL jobs listed, most recent FIRST. Each entry needs title, company, years (compute from dates if needed).',
      '5. Parse phone as +91XXXXXXXXXX for Indian numbers. Parse salary as "X LPA" when written in lakhs.',
      '6. current_location = city where candidate currently lives (not preferred city).',
      '7. Do NOT invent data. Use empty string "" or [] when absent.',
      '',
      structuredHint ?? '',
      '',
      'JSON schema (exact keys):',
      '{"full_name":"","email":"","phone":"","skills":["React","Node.js"],' +
        '"experience":[{"title":"Software Engineer","company":"Acme Pvt Ltd","years":"3","summary":"Built REST APIs"}],' +
        '"education":[{"degree":"B.Tech","institution":"IIT Mumbai","year":"2020"}],' +
        '"certifications":["AWS Certified"],"projects":["E-commerce platform"],"languages":["English","Hindi"],' +
        '"current_location":"Mumbai","preferred_locations":["Pune","Remote"],' +
        '"current_salary":"8 LPA","expected_salary":"12 LPA","notice_period":"30 days",' +
        '"work_preference":"Hybrid","preferred_roles":["Senior React Developer","Full Stack Engineer"]}',
      '',
      'Full resume text:',
      resumeText.slice(0, 16000),
    ].join('\n');
  }

  private buildFallbackParsePrompt(resumeText: string): string {
    return [
      'Extract resume fields as JSON only. Follow rules: full_name=person name not job title; skills=all technologies; experience=all jobs newest first with years.',
      '',
      '{"full_name":"","email":"","phone":"","skills":[],"experience":[{"title":"","company":"","years":"","summary":""}],' +
        '"education":[],"preferred_roles":[],"current_location":"","current_salary":"","expected_salary":"","notice_period":""}',
      '',
      resumeText.slice(0, 12000),
    ].join('\n');
  }

  private parseJson(raw: string): ParsedCareerProfile | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]) as unknown;
      return normalizeRawAiParse(obj) ?? (obj as ParsedCareerProfile);
    } catch {
      return null;
    }
  }

  private inferCurrentRole(profile: Record<string, unknown>): string {
    const exp = profile.experience;
    if (Array.isArray(exp) && exp.length > 0) {
      const latest = exp[0] as { title?: string };
      if (latest?.title) {
        return String(latest.title);
      }
    }
    return '';
  }

  private defaultRoadmap(currentRole: string, targetRoles: string): CareerRoadmapData {
    return {
      currentRole,
      steps: [
        { role: currentRole, timeframe: 'Now', focus: 'Strengthen core deliverables' },
        { role: `Senior ${currentRole}`, timeframe: '1-2 years', focus: 'Ownership & mentoring' },
        { role: targetRoles.split(',')[0]?.trim() || 'Lead / Architect', timeframe: '3-5 years', focus: 'Strategy & cross-team impact' },
      ],
      summary: 'Progress through depth in your current stack, then expand into leadership and architecture skills.',
    };
  }

  private defaultSkillGap(missingSkills: string[]): SkillGapPlanData {
    return {
      missingSkills,
      priorities: missingSkills.slice(0, 4).map((skill) => ({
        skill,
        why: `Frequently required in your top job matches.`,
        actions: [`Study ${skill} fundamentals`, `Build a small project using ${skill}`, 'Add it to your resume once practiced'],
        timeline: '2-3 months',
      })),
      summary: 'Focus on skills that appear most often in your best-matching jobs.',
    };
  }

  private defaultCertifications(skillGaps: string[]): CertificationRecData {
    const focus = skillGaps[0] ?? 'cloud';
    return {
      recommendations: [
        {
          name: 'Industry-recognized certification in your domain',
          provider: 'Major vendor (AWS / Azure / Google / PMI)',
          skills: skillGaps.slice(0, 3),
          reason: `Validates ${focus} skills employers filter for in India.`,
        },
      ],
      summary: 'Choose one certification aligned to your next role and study consistently for 8-12 weeks.',
    };
  }

  private parseJsonObject(raw: string): Record<string, unknown> | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parseEvalJson(raw: string): { score: number; feedback: string } | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]) as { score?: unknown; feedback?: unknown };
      if (typeof obj.score === 'number') {
        return {
          score: obj.score,
          feedback: String(obj.feedback ?? '').trim(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }
}
