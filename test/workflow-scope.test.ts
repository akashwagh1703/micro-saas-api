import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkflowLive, legacyStarterCloneFilter } from '../src/common/workflow-scope';
import { STARTER_TEMPLATE_SLUGS } from '../src/modules/workflows/workflow-templates';

describe('workflow-scope', () => {
  it('legacyStarterCloneFilter targets gallery demos without businessCategory', () => {
    const filter = legacyStarterCloneFilter();
    assert.ok(Array.isArray(filter.AND));
    assert.deepEqual((filter.AND as unknown[])[0], {
      sourceTemplate: { in: STARTER_TEMPLATE_SLUGS },
    });
    assert.deepEqual((filter.AND as unknown[])[1], { businessCategory: null });
  });

  it('isWorkflowLive requires published and active', () => {
    assert.equal(isWorkflowLive('published', true), true);
    assert.equal(isWorkflowLive('published', false), false);
    assert.equal(isWorkflowLive('draft', true), false);
  });
});
