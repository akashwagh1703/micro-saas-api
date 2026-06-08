import { StreamableFile } from '@nestjs/common';
import { CareerStorageService } from './services/career-storage.service';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function readCareerDocumentBuffer(
  storage: CareerStorageService,
  paths: {
    filePathDocx?: string | null;
    filePath?: string | null;
    content?: string | null;
  },
): Promise<Buffer | null> {
  const storagePath = paths.filePathDocx ?? paths.filePath;
  if (storagePath) {
    const buffer = await storage.readBuffer(storagePath);
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

export function inferDocumentMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
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

export { DOCX_MIME };
