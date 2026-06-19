import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_CATEGORY_KEYS,
  BUSINESS_VERTICALS,
  getVertical,
  isPluginVertical,
  serializePlatformCatalog,
  USE_CASE_KEYS,
} from '../src/platform/business-verticals.registry';

describe('business vertical registry', () => {
  it('includes CareerAI as a plugin vertical', () => {
    const career = getVertical('career_ai');
    assert.ok(career);
    assert.equal(career?.kind, 'plugin');
    assert.equal(career?.portal_route, '/career-ai');
    assert.equal(isPluginVertical('career_ai'), true);
    assert.equal(isPluginVertical('farmer'), false);
  });

  it('serializes a stable public catalog', () => {
    const catalog = serializePlatformCatalog();
    assert.equal(catalog.version, 1);
    assert.ok(catalog.verticals.length >= BUSINESS_VERTICALS.length);
    assert.ok(catalog.use_cases.length > 0);
    assert.deepEqual(
      catalog.verticals.map((v) => v.key).sort(),
      [...BUSINESS_CATEGORY_KEYS].sort(),
    );
    assert.deepEqual(
      catalog.use_cases.map((u) => u.key).sort(),
      [...USE_CASE_KEYS].sort(),
    );
  });
});
