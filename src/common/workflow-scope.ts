import { Prisma } from '@prisma/client';
import { SettingsService } from '../modules/settings/settings.service';
import { STARTER_TEMPLATE_SLUGS } from '../modules/workflows/workflow-templates';

/** Workflows visible in the portal: current business only, not archived, not starter demos. */
export async function buildVisibleWorkflowsWhere(
  userId: number,
  settings: SettingsService,
): Promise<Prisma.WorkflowWhereInput> {
  const businessCategory = await settings.get(userId, 'business_category');

  const where: Prisma.WorkflowWhereInput = {
    userId,
    isArchived: false,
    NOT: {
      sourceTemplate: { in: STARTER_TEMPLATE_SLUGS },
    },
  };

  if (businessCategory) {
    where.businessCategory = businessCategory;
  }

  return where;
}

/** Active published workflows for the user's current business (for change-business checks). */
export function currentBusinessPublishedWhere(
  userId: number,
  businessCategory: string,
): Prisma.WorkflowWhereInput {
  return {
    userId,
    businessCategory,
    isArchived: false,
    status: 'published',
    isActive: true,
  };
}

export function parseUseCases(settings: Record<string, string | null | undefined>): string[] {
  if (settings.use_cases) {
    try {
      const parsed = JSON.parse(settings.use_cases);
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => typeof v === 'string');
      }
    } catch {
      /* fall through */
    }
  }
  if (settings.use_case) {
    return [settings.use_case];
  }
  return [];
}
