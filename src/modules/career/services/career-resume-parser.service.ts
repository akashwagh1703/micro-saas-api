import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildExtractMeta,
  extractPdfTextOrdered,
  normalizeExtractedText,
  scoreExtractQuality,
  stripHtmlToText,
  type ResumeExtractMeta,
} from '../career-resume-extract.util';
import { ParsedCareerProfile } from '../career-parsed-profile.types';
import { extractBasicFieldsFromResume } from '../career-resume-parse.util';

export type ResumeExtractError =
  | 'too_large'
  | 'unsupported_format'
  | 'legacy_doc'
  | 'scanned_pdf'
  | 'ocr_failed';

export interface ResumeExtractResult {
  text: string;
  error?: ResumeExtractError;
  ocrUsed?: boolean;
  extractMeta?: ResumeExtractMeta;
}

/** Extracts plain text from PDF/DOCX/image resume uploads (R1 hardened). */
@Injectable()
export class CareerResumeParserService {
  private readonly logger = new Logger(CareerResumeParserService.name);
  private readonly ocrEnabled: boolean;
  private readonly pdfOcrEnabled: boolean;
  private readonly minChars: number;
  private readonly pdfOcrMaxPages: number;

  constructor(private readonly config: ConfigService) {
    this.ocrEnabled = this.config.get<string>('CAREER_OCR_ENABLED') !== 'false';
    this.pdfOcrEnabled = this.config.get<string>('CAREER_PDF_OCR_ENABLED') !== 'false';
    this.minChars = parseInt(this.config.get<string>('CAREER_EXTRACT_MIN_CHARS') ?? '80', 10);
    this.pdfOcrMaxPages = parseInt(this.config.get<string>('CAREER_PDF_OCR_MAX_PAGES') ?? '3', 10);
  }

  async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<ResumeExtractResult> {
    if (buffer.length > 10 * 1024 * 1024) {
      this.logger.warn(`Resume rejected — too large: ${buffer.length} bytes (${fileName})`);
      return { text: '', error: 'too_large' };
    }

    const lower = (mimeType || fileName || '').toLowerCase();
    const nameLower = fileName.toLowerCase();

    if (this.isLegacyDoc(lower, nameLower)) {
      return { text: '', error: 'legacy_doc' };
    }

    if (lower.includes('pdf') || nameLower.endsWith('.pdf')) {
      return this.extractPdfPipeline(buffer);
    }

    if (
      lower.includes('wordprocessingml') ||
      lower.includes('docx') ||
      nameLower.endsWith('.docx')
    ) {
      return this.extractDocxPipeline(buffer);
    }

    if (lower.includes('text/plain') || nameLower.endsWith('.txt')) {
      const text = normalizeExtractedText(buffer.toString('utf8').slice(0, 20000));
      return {
        text,
        extractMeta: buildExtractMeta('plain-text', text),
      };
    }

    if (
      this.ocrEnabled &&
      (lower.includes('image/') ||
        nameLower.endsWith('.jpg') ||
        nameLower.endsWith('.jpeg') ||
        nameLower.endsWith('.png') ||
        nameLower.endsWith('.webp'))
    ) {
      return this.extractImagePipeline(buffer);
    }

    this.logger.warn(`Unsupported resume format — mimeType=${mimeType} fileName=${fileName}`);
    return { text: '', error: 'unsupported_format' };
  }

  extractBasicFields(text: string): ParsedCareerProfile {
    return extractBasicFieldsFromResume(text);
  }

  private isLegacyDoc(mimeLower: string, nameLower: string): boolean {
    if (nameLower.endsWith('.docx')) {
      return false;
    }
    return (
      nameLower.endsWith('.doc') ||
      mimeLower.includes('application/msword') ||
      mimeLower === 'application/doc'
    );
  }

  private async extractPdfPipeline(buffer: Buffer): Promise<ResumeExtractResult> {
    let text = await this.extractPdfParse(buffer);
    let method: ResumeExtractMeta['method'] = 'pdf-parse';
    let pageCount: number | undefined;
    let quality = scoreExtractQuality(text);

    if (quality.score < 55 || text.length < this.minChars) {
      try {
        const ordered = await extractPdfTextOrdered(buffer);
        const orderedQuality = scoreExtractQuality(ordered.text);
        if (
          ordered.text.length > text.length ||
          orderedQuality.score > quality.score + 5
        ) {
          text = ordered.text;
          method = 'pdfjs-ordered';
          pageCount = ordered.pageCount;
          quality = orderedQuality;
          this.logger.debug(
            `PDF pdfjs-ordered used — ${text.length} chars, quality=${quality.score}`,
          );
        }
      } catch (err) {
        this.logger.warn(`PDF ordered extract failed: ${String(err)}`);
      }
    }

    let ocrUsed = false;
    if (
      this.ocrEnabled &&
      this.pdfOcrEnabled &&
      (text.length < this.minChars || quality.band === 'low')
    ) {
      try {
        const ocrText = await this.ocrPdf(buffer);
        const ocrQuality = scoreExtractQuality(ocrText);
        if (ocrText.length >= this.minChars && ocrQuality.score >= quality.score - 5) {
          text = ocrText;
          method = 'pdf-ocr';
          ocrUsed = true;
          quality = ocrQuality;
          this.logger.log(`PDF OCR fallback succeeded — ${text.length} chars, quality=${quality.score}`);
        }
      } catch (err) {
        this.logger.warn(`PDF OCR fallback failed: ${String(err)}`);
      }
    }

    if (text.length < this.minChars) {
      return {
        text: '',
        error: 'scanned_pdf',
        extractMeta: buildExtractMeta(method, text, { pageCount, ocrUsed }),
      };
    }

    return {
      text,
      ocrUsed,
      extractMeta: buildExtractMeta(method, text, { pageCount, ocrUsed }),
    };
  }

  private async extractDocxPipeline(buffer: Buffer): Promise<ResumeExtractResult> {
    let text = await this.extractDocxRaw(buffer);
    let method: ResumeExtractMeta['method'] = 'docx-raw';
    let quality = scoreExtractQuality(text);

    if (quality.score < 50 || text.length < this.minChars) {
      try {
        const htmlText = await this.extractDocxHtml(buffer);
        const htmlQuality = scoreExtractQuality(htmlText);
        if (htmlText.length > text.length || htmlQuality.score > quality.score) {
          text = htmlText;
          method = 'docx-html';
          quality = htmlQuality;
        }
      } catch (err) {
        this.logger.warn(`DOCX HTML fallback failed: ${String(err)}`);
      }
    }

    if (text.length < 40) {
      return {
        text: '',
        error: 'unsupported_format',
        extractMeta: buildExtractMeta(method, text),
      };
    }

    return {
      text,
      extractMeta: buildExtractMeta(method, text),
    };
  }

  private async extractImagePipeline(buffer: Buffer): Promise<ResumeExtractResult> {
    const text = await this.ocrImage(buffer);
    if (!text || text.length < 40) {
      return { text: '', error: 'ocr_failed' };
    }
    return {
      text,
      ocrUsed: true,
      extractMeta: buildExtractMeta('ocr-image', text, { ocrUsed: true }),
    };
  }

  private async extractPdfParse(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return normalizeExtractedText(String(data.text ?? ''));
    } catch (e: any) {
      this.logger.warn(`PDF parse failed: ${e.message}`);
      return '';
    }
  }

  private async extractDocxRaw(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return normalizeExtractedText(String(result.value ?? ''));
    } catch (e: any) {
      this.logger.warn(`DOCX parse failed: ${e.message}`);
      return '';
    }
  }

  private async extractDocxHtml(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ buffer });
    return normalizeExtractedText(stripHtmlToText(String(result.value ?? '')));
  }

  private async ocrPdf(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pdf } = require('pdf-to-img');
    const doc = await pdf(buffer, { scale: 2 });
    const parts: string[] = [];
    let pageNum = 0;

    try {
      for await (const pageImg of doc) {
        pageNum += 1;
        if (pageNum > this.pdfOcrMaxPages) {
          break;
        }
        const pageText = await this.ocrImage(pageImg as Buffer);
        if (pageText) {
          parts.push(pageText);
        }
      }
    } finally {
      await doc.destroy();
    }

    return normalizeExtractedText(parts.join('\n\n'));
  }

  private async ocrImage(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng');
      try {
        const result = await worker.recognize(buffer);
        return normalizeExtractedText(String(result.data?.text ?? ''));
      } finally {
        await worker.terminate();
      }
    } catch (e: any) {
      this.logger.warn(`OCR failed: ${e.message}`);
      return '';
    }
  }
}
