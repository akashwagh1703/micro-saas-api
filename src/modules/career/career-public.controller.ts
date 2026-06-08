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
import {
  careerDocxFileName,
  careerDocxStreamable,
  readCareerDocumentBuffer,
} from './career-document.util';

/** Public document downloads via signed token (no login — link sent on WhatsApp). */
@Controller('career/public')
export class CareerPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CareerStorageService,
    private readonly share: CareerDocumentShareService,
    private readonly docx: CareerDocxService,
  ) {}

  @Get('download')
  async download(@Query('token') token?: string): Promise<StreamableFile> {
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
      if (!version?.filePathDocx && !version?.filePath && !version?.content) {
        throw new NotFoundException('Document not found');
      }

      let buffer = await readCareerDocumentBuffer(this.storage, version);
      if (!buffer) {
        throw new NotFoundException('Document unavailable');
      }

      if (!version.filePathDocx && !version.filePath?.endsWith('.docx')) {
        const title = version.job
          ? `${version.job.title} — Resume`
          : version.title ?? 'Tailored resume';
        buffer = await this.docx.resumeFromText(title, version.content ?? buffer.toString('utf8'));
      }

      const fileName = careerDocxFileName(
        version.job
          ? `resume-${version.job.company}-${version.job.title}`
          : `resume-version-${version.id}`,
      );

      return careerDocxStreamable(buffer, fileName);
    }

    if (payload.kind === 'cover-letter') {
      const letter = await this.prisma.careerCoverLetter.findFirst({
        where: { id: payload.id, userId: payload.userId },
        include: { job: true },
      });
      if (!letter?.filePathDocx && !letter?.filePath && !letter?.content) {
        throw new NotFoundException('Document not found');
      }

      let buffer = await readCareerDocumentBuffer(this.storage, letter);
      if (!buffer) {
        throw new NotFoundException('Document unavailable');
      }

      if (!letter.filePathDocx && !letter.filePath?.endsWith('.docx')) {
        const title = letter.job
          ? `Cover Letter — ${letter.job.title} @ ${letter.job.company}`
          : 'Cover letter';
        buffer = await this.docx.coverLetterFromText(title, letter.content ?? buffer.toString('utf8'));
      }

      const fileName = careerDocxFileName(
        letter.job
          ? `cover-letter-${letter.job.company}-${letter.job.title}`
          : `cover-letter-${letter.id}`,
      );

      return careerDocxStreamable(buffer, fileName);
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
}
