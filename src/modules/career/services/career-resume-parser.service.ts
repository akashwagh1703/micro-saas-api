import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
