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

/** Public document downloads via signed token (no login — link sent on WhatsApp). */
@Controller('career/public')
export class CareerPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CareerStorageService,
    private readonly share: CareerDocumentShareService,
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
      if (!version?.filePath && !version?.content) {
        throw new NotFoundException('Document not found');
      }

      const buffer = version.filePath
        ? await this.storage.readBuffer(version.filePath)
        : Buffer.from(version.content ?? '', 'utf8');
      if (!buffer) {
        throw new NotFoundException('Document unavailable');
      }

      const fileName = version.job
        ? `resume-${version.job.company}-${version.job.title}.txt`.replace(/[^\w.-]+/g, '_')
        : `resume-version-${version.id}.txt`;

      return new StreamableFile(buffer, {
        type: 'text/plain; charset=utf-8',
        disposition: `attachment; filename="${fileName}"`,
      });
    }

    if (payload.kind === 'cover-letter') {
      const letter = await this.prisma.careerCoverLetter.findFirst({
        where: { id: payload.id, userId: payload.userId },
        include: { job: true },
      });
      if (!letter?.filePath && !letter?.content) {
        throw new NotFoundException('Document not found');
      }

      const buffer = letter.filePath
        ? await this.storage.readBuffer(letter.filePath)
        : Buffer.from(letter.content ?? '', 'utf8');
      if (!buffer) {
        throw new NotFoundException('Document unavailable');
      }

      const fileName = letter.job
        ? `cover-letter-${letter.job.company}-${letter.job.title}.txt`.replace(/[^\w.-]+/g, '_')
        : `cover-letter-${letter.id}.txt`;

      return new StreamableFile(buffer, {
        type: 'text/plain; charset=utf-8',
        disposition: `attachment; filename="${fileName}"`,
      });
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
