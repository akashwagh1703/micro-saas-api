import { Injectable, Logger } from '@nestjs/common';

export type ResumeExtractError = 'too_large' | 'unsupported_format';

export interface ResumeExtractResult {
  text: string;
  error?: ResumeExtractError;
}

/** Extracts plain text from PDF/DOCX resume uploads. */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<ResumeExtractResult> {
    // Reject files over 10 MB — prevents DB column bloat from extractedText.
    if (buffer.length > 10 * 1024 * 1024) {
      this.logger.warn(`Resume rejected — too large: ${buffer.length} bytes (${fileName})`);
      return { text: '', error: 'too_large' };
    }

    const lower = (mimeType || fileName || '').toLowerCase();

    if (lower.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
      const text = await this.extractPdf(buffer);
      return { text };
    }

    if (
      lower.includes('wordprocessingml') ||
      lower.includes('docx') ||
      fileName.toLowerCase().endsWith('.docx')
    ) {
      const text = await this.extractDocx(buffer);
      return { text };
    }

    // Plain-text resume — cap at 20 000 chars to keep DB size sane.
    if (lower.includes('text/plain') || fileName.toLowerCase().endsWith('.txt')) {
      return { text: buffer.toString('utf8').slice(0, 20000).trim() };
    }

    // All other formats (DOC, RTF, images) cannot be read — log and return empty
    // so the bot can reply with a clear format error instead of storing garbage.
    this.logger.warn(`Unsupported resume format — mimeType=${mimeType} fileName=${fileName}`);
    return { text: '', error: 'unsupported_format' };
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      const raw = String(data.text ?? '').trim();
      // pdf-parse often produces multiple consecutive spaces/newlines from column
      // layouts and tables. Normalise whitespace so the AI parser gets cleaner input.
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

  /**
   * Collapses runs of whitespace that PDF/DOCX parsers produce from table cells
   * and multi-column layouts. Reduces token usage and improves AI parse accuracy.
   *
   * Rules:
   *  - Multiple consecutive spaces → single space
   *  - More than 2 consecutive newlines → double newline (preserve paragraph breaks)
   *  - Lines that are entirely whitespace → removed
   */
  private normalizeWhitespace(text: string): string {
    return text
      .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')        // collapse excess blank lines
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }
}
