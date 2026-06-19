import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '@prisma/client';
import {
  selectWorkflowForMessage,
  triggerHitCount,
} from '../src/modules/workflows/workflow-selection.util';

function mockWorkflow(
  id: number,
  keywords: string | string[],
  opts: { match?: string; updatedAt?: Date; channel?: string } = {},
): Workflow {
  return {
    id,
    updatedAt: opts.updatedAt ?? new Date('2026-01-01'),
    definition: {
      nodes: [
        {
          type: 'trigger',
          data: {
            keywords,
            match: opts.match ?? 'any',
            channel: opts.channel ?? 'both',
          },
        },
      ],
    },
  } as unknown as Workflow;
}

describe('triggerHitCount', () => {
  it('returns 0 for catch-all triggers', () => {
    const w = mockWorkflow(1, []);
    assert.equal(triggerHitCount(w, 'hello', 'whatsapp'), 0);
  });

  it('returns null when channel does not match', () => {
    const w = mockWorkflow(1, ['help'], { channel: 'instagram' });
    assert.equal(triggerHitCount(w, 'help me', 'whatsapp'), null);
  });

  it('counts keyword hits for match=any', () => {
    const w = mockWorkflow(1, ['price', 'stock']);
    assert.equal(triggerHitCount(w, 'what is the price?', 'whatsapp'), 1);
  });
});

describe('selectWorkflowForMessage', () => {
  it('prefers keyword-specific workflow over catch-all', () => {
    const catchAll = mockWorkflow(1, [], { updatedAt: new Date('2026-06-01') });
    const specific = mockWorkflow(2, ['order'], { updatedAt: new Date('2026-01-01') });
    const picked = selectWorkflowForMessage([catchAll, specific], 'order status', 'whatsapp');
    assert.equal(picked?.id, 2);
  });

  it('breaks ties by most recently updated', () => {
    const older = mockWorkflow(1, ['help'], { updatedAt: new Date('2026-01-01') });
    const newer = mockWorkflow(2, ['help'], { updatedAt: new Date('2026-06-01') });
    const picked = selectWorkflowForMessage([older, newer], 'help please', 'whatsapp');
    assert.equal(picked?.id, 2);
  });

  it('returns null when nothing matches', () => {
    const w = mockWorkflow(1, ['xyz'], { channel: 'instagram' });
    assert.equal(selectWorkflowForMessage([w], 'hello', 'whatsapp'), null);
  });
});
