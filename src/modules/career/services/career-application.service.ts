import { Injectable } from '@nestjs/common';
import { CareerApplicationStatus } from '../career.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerAuditService } from './career-audit.service';

@Injectable()
export class CareerApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: CareerAuditService,
  ) {}

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

  async markApplied(
    userId: number,
    profileId: number,
    contactId: number,
    jobId: number,
    autoApplyQueued = false,
  ) {
    const status = autoApplyQueued ? 'auto_apply_queued' : 'applied';
    const existing = await this.prisma.careerApplication.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
    });

    const timeline = Array.isArray(existing?.timeline) ? [...(existing.timeline as object[])] : [];
    timeline.push({
      status,
      at: new Date().toISOString(),
      note: autoApplyQueued ? 'User opted into assisted auto-apply' : null,
    });

    return this.prisma.careerApplication.upsert({
      where: { profileId_jobId: { profileId, jobId } },
      create: {
        userId,
        profileId,
        contactId,
        jobId,
        status,
        timeline,
      },
      update: {
        status,
        timeline,
      },
      include: { job: true },
    });
  }

  async updateStatus(
    applicationId: number,
    status: CareerApplicationStatus,
    note?: string,
    actor?: { userId: number; label?: string },
  ) {
    const app = await this.prisma.careerApplication.findUnique({ where: { id: applicationId } });
    if (!app) return null;

    const previousStatus = app.status;
    const timeline = Array.isArray(app.timeline) ? [...(app.timeline as object[])] : [];
    timeline.push({ status, at: new Date().toISOString(), note: note ?? null });

    const updated = await this.prisma.careerApplication.update({
      where: { id: applicationId },
      data: { status, timeline, notes: note ?? app.notes },
      include: { job: true },
    });

    if (actor && previousStatus !== status) {
      await this.audit.log({
        userId: actor.userId,
        profileId: app.profileId,
        applicationId,
        action: 'application_status_changed',
        actorType: 'operator',
        actorLabel: actor.label,
        details: {
          from: previousStatus,
          to: status,
          note: note ?? null,
          job_id: app.jobId,
        },
      });
    }

    return updated;
  }
}
