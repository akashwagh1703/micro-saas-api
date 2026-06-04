import { Injectable } from '@nestjs/common';
import { CareerApplicationStatus } from '../career.constants';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class CareerApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async listForProfile(userId: number, profileId: number) {
    return this.prisma.careerApplication.findMany({
      where: { userId, profileId },
      include: { job: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertSaved(
    userId: number,
    profileId: number,
    contactId: number,
    jobId: number,
  ) {
    return this.prisma.careerApplication.upsert({
      where: { profileId_jobId: { profileId, jobId } },
      create: {
        userId,
        profileId,
        contactId,
        jobId,
        status: 'saved',
        timeline: [{ status: 'saved', at: new Date().toISOString() }],
      },
      update: {},
      include: { job: true },
    });
  }

  async updateStatus(applicationId: number, status: CareerApplicationStatus, note?: string) {
    const app = await this.prisma.careerApplication.findUnique({ where: { id: applicationId } });
    if (!app) return null;

    const timeline = Array.isArray(app.timeline) ? [...(app.timeline as object[])] : [];
    timeline.push({ status, at: new Date().toISOString(), note: note ?? null });

    return this.prisma.careerApplication.update({
      where: { id: applicationId },
      data: { status, timeline, notes: note ?? app.notes },
      include: { job: true },
    });
  }
}
