import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_CATEGORY_KEYS,
  BUSINESS_VERTICALS,
  CATALOG_VERSION,
  getSignupVerticals,
  getSignupUseCases,
  getVertical,
  isPluginVertical,
  serializePlatformCatalog,
  USE_CASE_KEYS,
  verticalProfileFields,
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

  it('includes salon with v4 catalog fields', () => {
    const salon = getVertical('salon');
    assert.ok(salon);
    assert.equal(salon?.max_use_cases, 1);
    assert.deepEqual(salon?.allowed_use_cases, ['appointment_booking']);
    assert.equal(salon?.visible_in_signup, true);
    assert.equal(salon?.deprecated, undefined);
  });

  it('exposes signup verticals (7 workflow + career_ai plugin)', () => {
    const signup = getSignupVerticals();
    const keys = signup.map((v) => v.key).sort();
    assert.deepEqual(keys, [
      'ca_accountant',
      'career_ai',
      'clinic',
      'coaching',
      'local_shop',
      'real_estate',
      'salon',
      'travel',
    ]);
    assert.ok(!keys.includes('farmer'));
    assert.ok(!keys.includes('other'));
  });

  it('exposes only active signup use cases', () => {
    const signup = getSignupUseCases().map((u) => u.key).sort();
    assert.deepEqual(signup, [
      'appointment_booking',
      'customer_support',
      'lead_generation',
    ]);
  });

  it('keeps deprecated verticals resolvable by key', () => {
    for (const key of ['farmer', 'insurance', 'support', 'other']) {
      const vertical = getVertical(key);
      assert.ok(vertical, key);
      assert.equal(vertical?.deprecated, true);
      assert.equal(vertical?.visible_in_signup, false);
    }
  });

  it('serializes catalog v2 with new fields', () => {
    const catalog = serializePlatformCatalog();
    assert.equal(catalog.version, CATALOG_VERSION);
    assert.equal(catalog.version, 2);
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
    const salon = catalog.verticals.find((v) => v.key === 'salon');
    assert.ok(salon?.allowed_use_cases);
    assert.equal(salon?.max_use_cases, 1);
  });

  it('returns profile fields for configured vertical', () => {
    assert.deepEqual(verticalProfileFields('salon'), {
      max_use_cases: 1,
      allowed_use_cases: ['appointment_booking'],
      vertical_deprecated: false,
    });
    assert.deepEqual(verticalProfileFields('farmer'), {
      max_use_cases: 2,
      allowed_use_cases: [
        'faq_bot',
        'customer_support',
        'lead_generation',
        'appointment_booking',
      ],
      vertical_deprecated: true,
    });
    assert.deepEqual(verticalProfileFields(null), {});
  });
});
