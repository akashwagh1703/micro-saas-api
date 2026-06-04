import { Injectable, Logger } from '@nestjs/common';

/** Extracts plain text from PDF/DOCX resume uploads. */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
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

    return buffer.toString('utf8').trim();
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
