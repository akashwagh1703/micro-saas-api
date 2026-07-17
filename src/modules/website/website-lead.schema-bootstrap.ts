import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "website_leads" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" VARCHAR(50) NOT NULL,
    "company_name" TEXT,
    "monthly_messages" INTEGER,
    "challenge" TEXT,
    "source" VARCHAR(50) NOT NULL DEFAULT 'website',
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "demo_date" TIMESTAMP(3),
    "demo_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_token" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
)`;

const COLUMN_ALTERS = [
  `ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0`,
  `ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "qualification" VARCHAR(20) DEFAULT 'cold'`,
  `ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
];

const INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "website_leads_email_key" ON "website_leads"("email")`,
  `CREATE INDEX IF NOT EXISTS "website_leads_email_idx" ON "website_leads"("email")`,
  `CREATE INDEX IF NOT EXISTS "website_leads_status_idx" ON "website_leads"("status")`,
  `CREATE INDEX IF NOT EXISTS "website_leads_business_type_idx" ON "website_leads"("business_type")`,
  `CREATE INDEX IF NOT EXISTS "website_leads_created_at_idx" ON "website_leads"("created_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "website_leads_confirmation_token_key" ON "website_leads"("confirmation_token")`,
];

/**
 * Ensures website_leads exists with columns required by the current Prisma schema.
 * Safe to run on every API startup (idempotent SQL).
 */
export async function ensureWebsiteLeadsSchema(
  prisma: PrismaService,
  logger: Logger,
  strict = false,
): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
    for (const sql of COLUMN_ALTERS) {
      await prisma.$executeRawUnsafe(sql);
    }
    for (const sql of INDEX_SQL) {
      await prisma.$executeRawUnsafe(sql);
    }
    await prisma.$queryRaw`
      SELECT id, score, qualification, notes, metadata, confirmation_token
      FROM "website_leads" LIMIT 1`;
    logger.log('Website leads table ready for demo capture');
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Website leads schema bootstrap failed: ${msg}`);
    if (strict) {
      throw error;
    }
    return false;
  }
}
