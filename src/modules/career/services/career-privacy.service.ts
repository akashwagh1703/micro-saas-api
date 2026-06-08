import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerStorageService } from './career-storage.service';
import { CareerAuditService, CareerAuditActorType } from './career-audit.service';

export interface DeleteProfileActor {
  type: CareerAuditActorType;
  label?: string;
}

@Injectable()
export class CareerPrivacyService {
  private readonly logger = new Logger(CareerPrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CareerStorageService,
    private readonly audit: CareerAuditService,
    private readonly config: ConfigService,
  ) {}

  /** Permanently delete a job seeker profile and all related PII (DB + object storage). */
  async deleteProfile(userId: number, profileId: number, actor: DeleteProfileActor) {
    const profile = await this.prisma.careerProfile.findFirst({
      where: { id: profileId, userId },
      include: {
        contact: true,
        resumes: { include: { versions: true } },
        coverLetters: true,
      },
    });

    if (!profile) {
      return null;
    }

    const filePaths: string[] = [];
    for (const resume of profile.resumes) {
      if (resume.filePath) {
        filePaths.push(resume.filePath);
      }
      for (const version of resume.versions) {
        if (version.filePath) filePaths.push(version.filePath);
        if (version.filePathPdf) filePaths.push(version.filePathPdf);
        if (version.filePathDocx) filePaths.push(version.filePathDocx);
      }
    }
    for (const letter of profile.coverLetters) {
      if (letter.filePath) filePaths.push(letter.filePath);
      if (letter.filePathPdf) filePaths.push(letter.filePathPdf);
      if (letter.filePathDocx) filePaths.push(letter.filePathDocx);
    }

    await this.audit.log({
      userId,
      profileId,
      action: 'profile_deleted',
      actorType: actor.type,
      actorLabel: actor.label,
      details: {
        contact_phone: profile.contact?.phone,
        contact_name: profile.contact?.name,
        resume_files: filePaths.length,
        cover_letters: profile.coverLetters.length,
      },
    });

    for (const filePath of filePaths) {
      await this.storage.deleteFile(filePath);
    }

    await this.prisma.careerProfile.delete({ where: { id: profileId } });

    this.logger.log(
      `Deleted CareerAI profile id=${profileId} userId=${userId} actor=${actor.type}`,
    );

    return { deleted: true, profile_id: profileId };
  }

  /**
   * Purge resume text stored in DB past retention window.
   * Files in object storage are kept; only extracted_text / generated content is cleared.
   */
  async purgeExpiredResumeText(): Promise<{ resumes: number; versions: number; coverLetters: number }> {
    const daysRaw = this.config.get<string>('CAREER_RESUME_TEXT_RETENTION_DAYS') ?? '365';
    const days = parseInt(daysRaw, 10);
    if (Number.isNaN(days) || days <= 0) {
      return { resumes: 0, versions: 0, coverLetters: 0 };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const [resumeUsers, versionUsers, coverUsers] = await Promise.all([
      this.prisma.careerResume.findMany({
        where: { createdAt: { lt: cutoff }, extractedText: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.careerResumeVersion.findMany({
        where: { createdAt: { lt: cutoff }, content: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.careerCoverLetter.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    const affectedUserIds = new Set<number>([
      ...resumeUsers.map((r) => r.userId),
      ...versionUsers.map((v) => v.userId),
      ...coverUsers.map((c) => c.userId),
    ]);

    const [resumeResult, versionResult, coverResult] = await Promise.all([
      this.prisma.careerResume.updateMany({
        where: {
          createdAt: { lt: cutoff },
          extractedText: { not: null },
        },
        data: { extractedText: null },
      }),
      this.prisma.careerResumeVersion.updateMany({
        where: {
          createdAt: { lt: cutoff },
          content: { not: null },
        },
        data: { content: null },
      }),
      this.prisma.careerCoverLetter.updateMany({
        where: {
          createdAt: { lt: cutoff },
        },
        data: { content: '[purged per retention policy]' },
      }),
    ]);

    for (const userId of affectedUserIds) {
      await this.audit.log({
        userId,
        action: 'resume_text_purged',
        actorType: 'system',
        actorLabel: 'retention_scheduler',
        details: {
          retention_days: days,
          cutoff: cutoff.toISOString(),
          resumes: resumeResult.count,
          versions: versionResult.count,
          cover_letters: coverResult.count,
        },
      });
    }

    this.logger.log(
      `Resume text retention purge — resumes=${resumeResult.count} versions=${versionResult.count} coverLetters=${coverResult.count}`,
    );

    return {
      resumes: resumeResult.count,
      versions: versionResult.count,
      coverLetters: coverResult.count,
    };
  }
}
