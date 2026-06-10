import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Generated delegate — explicit accessor keeps TS/IDE in sync after schema changes. */
  get billingTransaction(): Prisma.BillingTransactionDelegate {
    return super.billingTransaction;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    try {
      await this.$queryRaw`SELECT "business_category", "use_case", "is_archived" FROM "workflows" LIMIT 0`;
    } catch {
      this.logger.error(
        'Workflow table is missing business scope columns (business_category, use_case, is_archived). ' +
          'Run `npx prisma migrate deploy` against DATABASE_URL before using guided business setup.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
