import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PlatformAuditEntry {
  action: string;
  actorAdminId?: number | null;
  targetUserId?: number | null;
  paymentSubmissionId?: number | null;
  details?: Record<string, unknown>;
}

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: PlatformAuditEntry) {
    return this.prisma.platformAuditLog.create({
      data: {
        action: entry.action,
        actorAdminId: entry.actorAdminId ?? null,
        targetUserId: entry.targetUserId ?? null,
        paymentSubmissionId: entry.paymentSubmissionId ?? null,
        details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listForAdmin(params: { page?: number; actionPrefix?: string; perPage?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 25));
    const where: Prisma.PlatformAuditLogWhereInput = {};

    if (params.actionPrefix?.trim()) {
      where.action = { startsWith: params.actionPrefix.trim() };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          targetUser: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_admin_id: row.actorAdminId,
        target_user_id: row.targetUserId,
        target_user_name: row.targetUser?.name ?? null,
        target_user_email: row.targetUser?.email ?? null,
        payment_submission_id: row.paymentSubmissionId,
        details: row.details,
        created_at: row.createdAt.toISOString(),
      })),
      total,
      page,
      per_page: perPage,
    };
  }
}
