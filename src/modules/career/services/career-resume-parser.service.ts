import { Injectable, Logger } from '@nestjs/common';

/** Extracts plain text from PDF/DOCX resume uploads. */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
    // Reject files over 10 MB — prevents DB column bloat from extractedText.
    if (buffer.length > 10 * 1024 * 1024) {
      this.logger.warn(`Resume rejected — too large: ${buffer.length} bytes (${fileName})`);
      return '';
    }

    const lower = (mimeType || fileName || '').toLowerCase();

    if (lower.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
      return this.extractPdf(buffer);
    }

    if (
      lower.includes('wordprocessingml') ||
      lower.includes('docx') ||
      fileName.toLowerCase().endsWith('.docx')
    ) {
      return this.extractDocx(buffer);
    }

    // Plain-text resume — cap at 20 000 chars to keep DB size sane.
    if (lower.includes('text/plain') || fileName.toLowerCase().endsWith('.txt')) {
      return buffer.toString('utf8').slice(0, 20000).trim();
    }

    // All other formats (DOC, RTF, images) cannot be read — log and return empty
    // so the bot falls back to manual follow-up questions instead of storing garbage.
    this.logger.warn(`Unsupported resume format — mimeType=${mimeType} fileName=${fileName}`);
    return '';
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return String(data.text ?? '').trim();
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
      return String(result.value ?? '').trim();
    } catch (e: any) {
      this.logger.warn(`DOCX parse failed: ${e.message}`);
      return '';
    }
  }
}
