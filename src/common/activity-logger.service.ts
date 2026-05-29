import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Records entries in the `activities` table for the dashboard feed. */
@Injectable()
export class ActivityLogger {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    userId: number,
    type: string,
    title: string,
    description: string | null = null,
    metadata: Record<string, any> | null = null,
  ): Promise<void> {
    await this.prisma.activity.create({
      data: { userId, type, title, description, metadata: metadata ?? undefined },
    });
  }
}
