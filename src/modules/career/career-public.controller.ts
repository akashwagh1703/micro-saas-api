import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
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
import { CareerSeekerBillingService } from './services/career-seeker-billing.service';
import { CareerSeekerManualPaymentService } from './services/career-seeker-manual-payment.service';
import { CareerUpiConfigService } from './services/career-upi-config.service';
import { CareerPortalShareService } from './services/career-portal-share.service';
import { CareerMatchFeedbackService } from './services/career-match-feedback.service';
import { CareerMatchingService } from './services/career-matching.service';
import { MATCH_FEEDBACK_EVENTS, MatchFeedbackEvent } from './career-match-learning.util';
import {
  SeekerCancelSubscriptionDto,
  SeekerSubscribeDto,
  SeekerVerifySubscriptionDto,
  SubmitSeekerManualPaymentDto,
} from './dto/career-seeker-billing.dto';
import { RejectPaymentSubmissionDto } from '../billing/dto/billing.dto';

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
    private readonly seekerBilling: CareerSeekerBillingService,
    private readonly seekerManualPayment: CareerSeekerManualPaymentService,
    private readonly upiConfig: CareerUpiConfigService,
    private readonly portalShare: CareerPortalShareService,
    private readonly matchFeedback: CareerMatchFeedbackService,
    private readonly matching: CareerMatchingService,
  ) {}

  @Get('portal')
  async getPortal(@Query('token') token?: string) {
    if (!token?.trim()) {
      throw new NotFoundException('Invalid or expired link');
    }
    return this.portalService.getPortalData(token);
  }

  @Post('match-feedback')
  async recordMatchFeedback(
    @Body() body: { token?: string; job_id?: number; event?: string },
  ) {
    const payload = this.requirePortalToken(body.token);
    const jobId = Number(body.job_id);
    const event = body.event as MatchFeedbackEvent;

    if (!jobId || Number.isNaN(jobId) || !event || !MATCH_FEEDBACK_EVENTS.includes(event)) {
      throw new UnprocessableEntityException('Invalid job_id or event');
    }

    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: payload.profileId, userId: payload.userId },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const job = await this.prisma.careerJob.findFirst({
      where: { id: jobId, userId: payload.userId },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    await this.matchFeedback.recordEvent(payload.userId, profile, job, event, {
      source: 'portal',
    });

    if (event === 'dismissed') {
      const refreshed = await this.prisma.careerProfile.findUnique({ where: { id: profile.id } });
      await this.matching.matchAndPersistForProfile(
        payload.userId,
        refreshed ?? profile,
        { tier: 'good' },
      );
    }

    return { ok: true, event, job_id: jobId };
  }

  @Get('billing/status')
  async billingStatus(@Query('token') token?: string) {
    const payload = this.requirePortalToken(token);
    return this.seekerBilling.getStatusForProfile(payload.profileId, payload.userId);
  }

  @Get('billing/payment-config')
  async billingPaymentConfig(@Query('token') token?: string) {
    const payload = this.requirePortalToken(token);
    return this.seekerManualPayment.getPaymentConfig(payload.userId, token?.trim());
  }

  @Get('billing/upi-qr')
  async billingUpiQr(@Query('token') token: string, @Res({ passthrough: false }) res: Response) {
    const payload = this.requirePortalToken(token);
    const file = await this.upiConfig.readQrImage(payload.userId);
    if (!file) {
      throw new NotFoundException('QR code not found');
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  }

  @Post('billing/manual-payment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async billingManualPayment(
    @Body() dto: SubmitSeekerManualPaymentDto,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const payload = this.requirePortalToken(dto.token);
    return this.seekerManualPayment.submitManualPayment(
      payload.profileId,
      payload.userId,
      dto.plan,
      dto.upi_transaction_id,
      {
        buffer: file?.buffer ?? Buffer.alloc(0),
        mimetype: file?.mimetype ?? 'image/jpeg',
      },
    );
  }

  @Post('billing/subscribe')
  async billingSubscribe(@Body() dto: SeekerSubscribeDto) {
    const payload = this.requirePortalToken(dto.token);
    return this.seekerBilling.createSubscription(payload.profileId, payload.userId, dto.plan);
  }

  @Post('billing/verify')
  async billingVerify(@Body() dto: SeekerVerifySubscriptionDto) {
    const payload = this.requirePortalToken(dto.token);
    const status = await this.seekerBilling.activateFromCheckout(
      payload.profileId,
      payload.userId,
      dto.razorpay_payment_id,
      dto.razorpay_subscription_id,
      dto.razorpay_signature,
    );
    return { status };
  }

  @Post('billing/cancel')
  async billingCancel(@Body() dto: SeekerCancelSubscriptionDto) {
    const payload = this.requirePortalToken(dto.token);
    const status = await this.seekerBilling.cancelSubscription(payload.profileId, payload.userId);
    return { status };
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

  private requirePortalToken(token?: string) {
    if (!token?.trim()) {
      throw new NotFoundException('Invalid or expired link');
    }
    const payload = this.portalShare.verifyToken(token.trim());
    if (!payload) {
      throw new NotFoundException('Invalid or expired link');
    }
    return payload;
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
