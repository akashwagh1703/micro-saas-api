import { Workflow } from '@prisma/client';
import { triggerChannelMatches } from './workflow-trigger-channel';

export interface WorkflowMatchCandidate {
  workflow: Workflow;
  hits: number;
}

/**
 * Pick a single workflow to run for an inbound message. Keyword-specific
 * workflows win over catch-all ones; among keyword matches the most specific
 * (most keyword hits) wins, with the most recently updated as the tie-break.
 */
export function selectWorkflowForMessage(
  workflows: Workflow[],
  content: string,
  messageChannel: string,
): Workflow | null {
  const matching = workflows
    .map((w) => ({ workflow: w, hits: triggerHitCount(w, content, messageChannel) }))
    .filter((m): m is WorkflowMatchCandidate => m.hits !== null);

  if (matching.length === 0) {
    return null;
  }

  const keyword = matching.filter((m) => m.hits > 0);
  const pool = keyword.length > 0 ? keyword : matching;

  pool.sort((a, b) => {
    if (b.hits !== a.hits) {
      return b.hits - a.hits;
    }
    return updatedAtMs(b.workflow) - updatedAtMs(a.workflow);
  });

  return pool[0].workflow;
}

function updatedAtMs(workflow: Workflow): number {
  return workflow.updatedAt ? new Date(workflow.updatedAt).getTime() : 0;
}

export function triggerHitCount(
  workflow: Workflow,
  messageText: string,
  messageChannel: string,
): number | null {
  const definition = (workflow.definition as { nodes?: Array<{ type?: string; data?: Record<string, unknown> }> }) ?? {};
  const trigger = (definition.nodes ?? []).find((n) => n.type === 'trigger');
  const data = trigger?.data ?? {};

  if (!triggerChannelMatches(data, messageChannel)) {
    return null;
  }

  const raw = data.keywords ?? '';
  const keywords = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((k) => String(k).trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    return 0;
  }

  const match = (data.match as string) ?? 'any';
  const haystack = messageText.toLowerCase();

  const hits = keywords.filter((k) =>
    match === 'exact' ? haystack === k.toLowerCase() : haystack.includes(k.toLowerCase()),
  );

  if (match === 'all') {
    return hits.length === keywords.length ? hits.length : null;
  }

  return hits.length > 0 ? hits.length : null;
}
