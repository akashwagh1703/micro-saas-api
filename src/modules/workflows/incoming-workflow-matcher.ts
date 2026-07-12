import { Workflow } from '@prisma/client';
import { USE_CASE_TRIGGER_KEYWORDS } from './business-workflow';
import { selectWorkflowForMessage } from './workflow-selection.util';

/** Keywords that start a fresh appointment booking session. */
export function messageMatchesBookingIntent(content: string): boolean {
  const haystack = content.toLowerCase();
  return USE_CASE_TRIGGER_KEYWORDS.appointment_booking.some((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
}

/**
 * Loads published auto-replies for the tenant, including legacy rows with null
 * businessCategory when a business profile is configured.
 */
export function buildPublishedWorkflowWhere(
  userId: number,
  businessCategory: string | null,
): Record<string, unknown> {
  const base = {
    userId,
    status: 'published',
    isActive: true,
    isArchived: false,
    triggerType: 'message_received',
  };

  if (!businessCategory) {
    return base;
  }

  return {
    ...base,
    OR: [{ businessCategory }, { businessCategory: null }],
  };
}

/** Prefer workflows tagged for the active business over legacy null-category rows. */
export function selectWorkflowForBusiness(
  workflows: Workflow[],
  content: string,
  messageChannel: string,
  businessCategory: string | null,
): Workflow | null {
  if (!workflows.length) {
    return null;
  }

  if (businessCategory) {
    const tagged = workflows.filter((w) => w.businessCategory === businessCategory);
    if (tagged.length > 0) {
      const picked = selectWorkflowForMessage(tagged, content, messageChannel);
      if (picked) {
        return picked;
      }
    }
  }

  return selectWorkflowForMessage(workflows, content, messageChannel);
}
