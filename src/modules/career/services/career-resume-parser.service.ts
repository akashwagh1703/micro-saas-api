import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParsedCareerProfile } from './career-ai.service';

export type ResumeExtractError =
  | 'too_large'
  | 'unsupported_format'
  | 'scanned_pdf'
  | 'ocr_failed';

export interface ResumeExtractResult {
  text: string;
  error?: ResumeExtractError;
  ocrUsed?: boolean;
}

/** Extracts plain text from PDF/DOCX/image resume uploads. */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);
  private readonly ocrEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.ocrEnabled = this.config.get<string>('CAREER_OCR_ENABLED') !== 'false';
  }

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<ResumeExtractResult> {
    if (buffer.length > 10 * 1024 * 1024) {
      this.logger.warn(`Resume rejected — too large: ${buffer.length} bytes (${fileName})`);
      return { text: '', error: 'too_large' };
    }

    const lower = (mimeType || fileName || '').toLowerCase();
    const nameLower = fileName.toLowerCase();

    if (lower.includes('pdf') || nameLower.endsWith('.pdf')) {
      const text = await this.extractPdf(buffer);
      if (text.length < 80) {
        return {
          text: '',
          error: 'scanned_pdf',
        };
      }
      return { text };
    }

    if (
      lower.includes('wordprocessingml') ||
      lower.includes('docx') ||
      nameLower.endsWith('.docx')
    ) {
      const text = await this.extractDocx(buffer);
      return { text };
    }

    if (
      lower.includes('text/plain') ||
      nameLower.endsWith('.txt')
    ) {
      return { text: buffer.toString('utf8').slice(0, 20000).trim() };
    }

    if (
      this.ocrEnabled &&
      (lower.includes('image/') ||
        nameLower.endsWith('.jpg') ||
        nameLower.endsWith('.jpeg') ||
        nameLower.endsWith('.png') ||
        nameLower.endsWith('.webp'))
    ) {
      const text = await this.ocrImage(buffer);
      if (!text) {
        return { text: '', error: 'ocr_failed' };
      }
      return { text, ocrUsed: true };
    }

    this.logger.warn(`Unsupported resume format — mimeType=${mimeType} fileName=${fileName}`);
    return { text: '', error: 'unsupported_format' };
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      const raw = String(data.text ?? '').trim();
      return this.normalizeWhitespace(raw);
    } catch (e: any) {
      this.logger.warn(`PDF parse failed: ${e.message}`);
      return '';
    }
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const raw = String(result.value ?? '').trim();
      return this.normalizeWhitespace(raw);
    } catch (e: any) {
      this.logger.warn(`DOCX parse failed: ${e.message}`);
      return '';
    }
  }

  private async ocrImage(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng');
      try {
        const result = await worker.recognize(buffer);
        return this.normalizeWhitespace(String(result.data?.text ?? ''));
      } finally {
        await worker.terminate();
      }
    } catch (e: any) {
      this.logger.warn(`OCR failed: ${e.message}`);
      return '';
    }
  }

  /**
   * Heuristic fallback when AI parsing fails — extracts verifiable facts only.
   */
  extractBasicFields(text: string): ParsedCareerProfile {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const blob = text.toLowerCase();

    const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
    const phone =
      text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/)?.[0] ??
      text.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/)?.[0];

    const cities = [
      'mumbai', 'pune', 'bangalore', 'bengaluru', 'delhi', 'noida', 'gurgaon', 'gurugram',
      'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'indore', 'remote',
    ];
    const currentLocation = cities.find((c) => blob.includes(c));
    const locationMatch = text.match(
      /(?:location|city|based in|address)[:\s]+([A-Za-z\s,.-]{3,40})/i,
    );
    const parsedLocation = locationMatch?.[1]?.split(/[,|]/)[0]?.trim();

    const skillBank = [
      'react', 'node.js', 'nodejs', 'javascript', 'typescript', 'python', 'java', 'spring',
      'angular', 'vue', 'laravel', 'php', 'mysql', 'postgresql', 'mongodb', 'aws', 'docker',
      'kubernetes', 'devops', 'sales', 'marketing', 'accounting', 'excel', 'communication',
      'leadership', 'nestjs', 'express', 'html', 'css', 'sql', 'git', 'agile', 'scrum',
    ];
    const skills = skillBank.filter((s) => blob.includes(s.toLowerCase()));

    const salaryMatch = text.match(/(?:expected|current)?\s*salary[:\s]+([^\n]{3,30})/i);
    const noticeMatch = text.match(/notice\s*period[:\s]+([^\n]{2,20})/i);

    const fullName =
      lines[0]?.length <= 60 && !/@|\d{5,}/.test(lines[0]) ? lines[0] : undefined;

    const experience: ParsedCareerProfile['experience'] = [];
    for (const line of lines) {
      const m = line.match(
        /^(.{3,60}?)\s*(?:at|@|\||–|-)\s*(.{2,60}?)(?:\s*\((\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)?\))?/i,
      );
      if (m && !/education|skills|summary/i.test(line)) {
        experience.push({
          title: m[1].trim(),
          company: m[2].trim(),
          years: m[3] ?? undefined,
        });
        if (experience.length >= 5) {
          break;
        }
      }
    }

    const roleHints = [
      'developer', 'engineer', 'manager', 'analyst', 'designer', 'consultant', 'executive',
      'specialist', 'lead', 'architect', 'administrator', 'coordinator',
    ];
    const preferredRoles = experience
      .map((e) => e.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, 3);
    if (preferredRoles.length === 0) {
      const titleLine = lines.find((l) => roleHints.some((r) => l.toLowerCase().includes(r)));
      if (titleLine && titleLine.length < 80) {
        preferredRoles.push(titleLine);
      }
    }

    return {
      full_name: fullName,
      email,
      phone,
      skills: skills.length > 0 ? skills : undefined,
      experience: experience.length > 0 ? experience : undefined,
      current_location: parsedLocation ?? (currentLocation ? this.capitalize(currentLocation) : undefined),
      current_salary: salaryMatch?.[1]?.trim(),
      notice_period: noticeMatch?.[1]?.trim(),
      preferred_roles: preferredRoles.length > 0 ? preferredRoles : undefined,
    };
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private normalizeWhitespace(text: string): string {
    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }
}
