import { StreamableFile } from '@nestjs/common';
import { CareerStorageService } from './services/career-storage.service';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

export type CareerDocumentFormat = 'pdf' | 'docx';

export async function readCareerDocumentBuffer(
  storage: CareerStorageService,
  paths: {
    filePathPdf?: string | null;
    filePathDocx?: string | null;
    filePath?: string | null;
    content?: string | null;
  },
  format: CareerDocumentFormat = 'docx',
): Promise<Buffer | null> {
  const preferred =
    format === 'pdf'
      ? paths.filePathPdf ?? paths.filePath
      : paths.filePathDocx ?? paths.filePath;

  if (preferred) {
    const buffer = await storage.readBuffer(preferred);
    if (buffer) {
      return buffer;
    }
  }

  const fallback =
    format === 'pdf' ? paths.filePathDocx ?? paths.filePath : paths.filePathPdf ?? paths.filePath;
  if (fallback && fallback !== preferred) {
    const buffer = await storage.readBuffer(fallback);
    if (buffer) {
      return buffer;
    }
  }

  if (paths.content) {
    return Buffer.from(paths.content, 'utf8');
  }
  return null;
}

export function careerDocxFileName(base: string): string {
  const safe = base.replace(/[^\w.-]+/g, '_').replace(/\.docx$/i, '');
  return `${safe}.docx`;
}

export function careerPdfFileName(base: string): string {
  const safe = base.replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '');
  return `${safe}.pdf`;
}

export function inferDocumentMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return PDF_MIME;
  if (lower.endsWith('.docx')) {
    return DOCX_MIME;
  }
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

export function careerDocxStreamable(buffer: Buffer, fileName: string): StreamableFile {
  return new StreamableFile(buffer, {
    type: DOCX_MIME,
    disposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
  });
}

export function careerPdfStreamable(buffer: Buffer, fileName: string): StreamableFile {
  return new StreamableFile(buffer, {
    type: PDF_MIME,
    disposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
  });
}

export { DOCX_MIME, PDF_MIME };
