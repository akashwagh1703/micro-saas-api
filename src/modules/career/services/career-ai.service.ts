import { Injectable } from '@nestjs/common';
import { AiService } from '../../integrations/ai.service';

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
}

@Injectable()
export class CareerAiService {
  constructor(private readonly ai: AiService) {}

  async parseResume(userId: number, resumeText: string): Promise<ParsedCareerProfile | null> {
    const prompt = `You are a resume parser. Extract structured JSON from this resume. Return ONLY valid JSON with keys:
full_name, email, phone, skills (array), experience (array of objects), education (array), certifications (array), projects (array), languages (array).

Resume:
${resumeText.slice(0, 12000)}`;

    const result = await this.ai.complete(userId, prompt, { max_tokens: 2048, temperature: 0.2 });
    if (!result.success || !result.content) {
      return null;
    }
    return this.parseJson(result.content);
  }

  async generateTailoredResume(
    userId: number,
    profile: Record<string, unknown>,
    job: { title: string; company: string; description?: string | null },
  ): Promise<string | null> {
    const prompt = `Create a tailored resume for this job. Return plain text resume only.

Job: ${job.title} at ${job.company}
Description: ${job.description ?? 'N/A'}

Candidate profile JSON:
${JSON.stringify(profile).slice(0, 8000)}`;

    const result = await this.ai.complete(userId, prompt, { max_tokens: 3000, temperature: 0.5 });
    return result.success ? (result.content ?? null) : null;
  }

  async generateCoverLetter(
    userId: number,
    profile: Record<string, unknown>,
    job: { title: string; company: string; description?: string | null },
  ): Promise<string | null> {
    const prompt = `Write a professional cover letter for this candidate applying to ${job.title} at ${job.company}.
Return plain text only. Keep under 400 words.

Job description: ${job.description ?? 'N/A'}
Candidate: ${JSON.stringify(profile).slice(0, 6000)}`;

    const result = await this.ai.complete(userId, prompt, { max_tokens: 1500, temperature: 0.6 });
    return result.success ? (result.content ?? null) : null;
  }

  async careerAdvice(userId: number, question: string, profile: Record<string, unknown>): Promise<string> {
    const prompt = `You are CareerAI, a helpful career coach on WhatsApp. Answer briefly (under 300 words).

Candidate profile: ${JSON.stringify(profile).slice(0, 4000)}
Question: ${question}`;

    const result = await this.ai.complete(userId, prompt, { max_tokens: 512, temperature: 0.7 });
    return result.content ?? result.error ?? 'I could not generate advice right now. Please try again.';
  }

  async interviewPrep(
    userId: number,
    role: string,
    profile: Record<string, unknown>,
  ): Promise<string> {
    const prompt = `Prepare interview tips for a ${role} role. Include 5 likely questions and sample answers. Keep under 400 words.

Profile: ${JSON.stringify(profile).slice(0, 4000)}`;

    const result = await this.ai.complete(userId, prompt, { max_tokens: 800, temperature: 0.6 });
    return result.content ?? 'Interview prep is unavailable. Try again later.';
  }

  private parseJson(raw: string): ParsedCareerProfile | null {
    const trimmed = raw.trim();
    const jsonBlock = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonBlock) {
      return null;
    }
    try {
      return JSON.parse(jsonBlock[0]) as ParsedCareerProfile;
    } catch {
      return null;
    }
  }
}
