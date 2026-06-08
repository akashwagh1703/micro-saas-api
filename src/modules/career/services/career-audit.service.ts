import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type CareerAuditActorType = 'operator' | 'job_seeker' | 'system';

export interface CareerAuditEntry {
  userId: number;
  action: string;
  profileId?: number;
  applicationId?: number;
  actorType: CareerAuditActorType;
  actorLabel?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class CareerAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: CareerAuditEntry) {
    return this.prisma.careerAuditLog.create({
      data: {
        userId: entry.userId,
        profileId: entry.profileId,
        applicationId: entry.applicationId,
        action: entry.action,
        actorType: entry.actorType,
        actorLabel: entry.actorLabel,
        details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listForUser(userId: number, page = 1, perPage = 30) {
    const skip = (Math.max(1, page) - 1) * perPage;
    const [items, total] = await Promise.all([
      this.prisma.careerAuditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.careerAuditLog.count({ where: { userId } }),
    ]);
    return { items, total, page, per_page: perPage };
  }
}
