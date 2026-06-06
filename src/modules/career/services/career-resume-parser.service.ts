import { Injectable, Logger } from '@nestjs/common';

/** Extracts plain text from PDF/DOCX resume uploads. */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
    // Reject files larger than 10 MB to prevent DB bloat.
    if (buffer.length > 10 * 1024 * 1024) {
      this.logger.warn(`Resume rejected — too large: ${buffer.length} bytes`);
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

    if (fileName.toLowerCase().endsWith('.txt') || lower.includes('text/plain')) {
      return buffer.toString('utf8').slice(0, 20000).trim();
    }

    this.logger.warn(`Unsupported resume format: mimeType=${mimeType} fileName=${fileName}`);
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
