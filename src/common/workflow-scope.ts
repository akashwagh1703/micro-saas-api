import { Prisma } from '@prisma/client';
import { SettingsService } from '../modules/settings/settings.service';
import { STARTER_TEMPLATE_SLUGS } from '../modules/workflows/workflow-templates';

/**
 * Legacy template-gallery clones (no business profile). Business-setup workflows
 * reuse the same template slugs but always have businessCategory set — keep those visible.
 */
export function legacyStarterCloneFilter(): Prisma.WorkflowWhereInput {
  return {
    AND: [{ sourceTemplate: { in: STARTER_TEMPLATE_SLUGS } }, { businessCategory: null }],
  };
}

/** Workflows visible in the portal: current business only, not archived, not legacy demos. */
export async function buildVisibleWorkflowsWhere(
  userId: number,
  settings: SettingsService,
): Promise<Prisma.WorkflowWhereInput> {
  const businessCategory = await settings.get(userId, 'business_category');

  const where: Prisma.WorkflowWhereInput = {
    userId,
    isArchived: false,
    NOT: legacyStarterCloneFilter(),
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

/** True when a workflow is actively sending auto-replies. */
export function isWorkflowLive(status: string, isActive: boolean): boolean {
  return status === 'published' && isActive;
}
