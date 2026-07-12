import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublishedWorkflowWhere,
  messageMatchesBookingIntent,
  selectWorkflowForBusiness,
} from '../src/modules/workflows/incoming-workflow-matcher';

describe('incoming workflow matcher', () => {
  it('detects booking intent keywords', () => {
    assert.equal(messageMatchesBookingIntent('book'), true);
    assert.equal(messageMatchesBookingIntent('I want an appointment'), true);
    assert.equal(messageMatchesBookingIntent('hello'), false);
  });

  it('includes legacy null businessCategory in published workflow query', () => {
    const where = buildPublishedWorkflowWhere(1, 'salon') as {
      OR?: { businessCategory: string | null }[];
    };
    assert.ok(where.OR);
    assert.deepEqual(where.OR, [{ businessCategory: 'salon' }, { businessCategory: null }]);
  });

  it('prefers workflows tagged for the active business', () => {
    const workflows = [
      {
        id: 1,
        name: 'Legacy',
        businessCategory: null,
        updatedAt: new Date('2026-01-02'),
        definition: {
          nodes: [
            {
              type: 'trigger',
              data: { keywords: 'book', channel: 'both', match: 'any' },
            },
          ],
        },
      },
      {
        id: 2,
        name: 'Salon booking',
        businessCategory: 'salon',
        updatedAt: new Date('2026-01-01'),
        definition: {
          nodes: [
            {
              type: 'trigger',
              data: { keywords: 'book,appointment', channel: 'both', match: 'any' },
            },
          ],
        },
      },
    ] as any[];

    const picked = selectWorkflowForBusiness(workflows, 'book appointment', 'whatsapp', 'salon');
    assert.equal(picked?.id, 2);
  });
});
