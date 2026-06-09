import {
  Controller,
  Get,
  NotFoundException,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CareerStorageService } from './services/career-storage.service';
import { CareerDocumentShareService } from './services/career-document-share.service';
import { CareerDocxService } from './services/career-docx.service';
import { CareerPdfService } from './services/career-pdf.service';
import {
  careerDocxFileName,
  careerDocxStreamable,
  careerPdfFileName,
  careerPdfStreamable,
  readCareerDocumentBuffer,
  type CareerDocumentFormat,
} from './career-document.util';

import { CareerPortalService } from './services/career-portal.service';

/** Public document downloads and candidate portal (signed token — no login). */
@Controller('career/public')
export class CareerPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CareerStorageService,
    private readonly share: CareerDocumentShareService,
    private readonly docx: CareerDocxService,
    private readonly pdf: CareerPdfService,
    private readonly portalService: CareerPortalService,
  ) {}

  @Get('portal')
  async getPortal(@Query('token') token?: string) {
    if (!token?.trim()) {
      throw new NotFoundException('Invalid or expired link');
    }
    return this.portalService.getPortalData(token);
  }

  @Get('download')
  async download(
    @Query('token') token?: string,
    @Query('format') format?: string,
  ): Promise<StreamableFile> {
    const docFormat: CareerDocumentFormat =
      format?.trim().toLowerCase() === 'docx' ? 'docx' : 'pdf';
    if (!token?.trim()) {
      throw new NotFoundException('Invalid or expired link');
    }

    const payload = this.share.verifyToken(token.trim());
    if (!payload) {
      throw new NotFoundException('Invalid or expired link');
    }

    if (payload.kind === 'resume-version') {
      const version = await this.prisma.careerResumeVersion.findFirst({
        where: { id: payload.id, userId: payload.userId },
        include: { job: true },
      });
      if (!version?.filePathDocx && !version?.filePathPdf && !version?.filePath && !version?.content) {
        throw new NotFoundException('Document not found');
      }

      const title = version.job
        ? `${version.job.title} — Resume`
        : version.title ?? 'Tailored resume';
      const baseName = version.job
        ? `resume-${version.job.company}-${version.job.title}`
        : `resume-version-${version.id}`;

      return this.streamGeneratedDocument(
        version,
        docFormat,
        title,
        baseName,
        (t, body) => this.docx.resumeFromText(t, body),
        (t, body) => this.pdf.fromText(t, body),
      );
    }

    if (payload.kind === 'cover-letter') {
      const letter = await this.prisma.careerCoverLetter.findFirst({
        where: { id: payload.id, userId: payload.userId },
        include: { job: true },
      });
      if (!letter?.filePathDocx && !letter?.filePathPdf && !letter?.filePath && !letter?.content) {
        throw new NotFoundException('Document not found');
      }

      const title = letter.job
        ? `Cover Letter — ${letter.job.title} @ ${letter.job.company}`
        : 'Cover letter';
      const baseName = letter.job
        ? `cover-letter-${letter.job.company}-${letter.job.title}`
        : `cover-letter-${letter.id}`;

      return this.streamGeneratedDocument(
        letter,
        docFormat,
        title,
        baseName,
        (t, body) => this.docx.coverLetterFromText(t, body),
        (t, body) => this.pdf.fromText(t, body),
      );
    }

    if (payload.kind === 'resume') {
      const resume = await this.prisma.careerResume.findFirst({
        where: { id: payload.id, userId: payload.userId },
      });
      if (!resume?.filePath) {
        throw new NotFoundException('Document not found');
      }

      const buffer = await this.storage.readBuffer(resume.filePath);
      if (!buffer) {
        throw new NotFoundException('Document unavailable');
      }

      const fileName = resume.fileName ?? `resume-${resume.id}.pdf`;
      return new StreamableFile(buffer, {
        type: resume.mimeType ?? 'application/octet-stream',
        disposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
      });
    }

    throw new NotFoundException('Invalid or expired link');
  }

  private async streamGeneratedDocument(
    record: {
      filePathPdf?: string | null;
      filePathDocx?: string | null;
      filePath?: string | null;
      content?: string | null;
    },
    format: CareerDocumentFormat,
    title: string,
    baseName: string,
    toDocx: (title: string, body: string) => Promise<Buffer>,
    toPdf: (title: string, body: string) => Promise<Buffer>,
  ): Promise<StreamableFile> {
    let buffer = await readCareerDocumentBuffer(this.storage, record, format);
    const plainText = record.content ?? (buffer ? buffer.toString('utf8') : '');

    if (!buffer && plainText) {
      buffer =
        format === 'pdf'
          ? await toPdf(title, plainText)
          : await toDocx(title, plainText);
    } else if (buffer && plainText && buffer.length < 256 && format === 'docx') {
      buffer = await toDocx(title, plainText);
    } else if (buffer && plainText && buffer.length < 256 && format === 'pdf') {
      buffer = await toPdf(title, plainText);
    }

    if (!buffer) {
      throw new NotFoundException('Document unavailable');
    }

    if (format === 'pdf') {
      return careerPdfStreamable(buffer, careerPdfFileName(baseName));
    }
    return careerDocxStreamable(buffer, careerDocxFileName(baseName));
  }
}
