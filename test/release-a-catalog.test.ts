/**
 * Release A (Phase 4) catalog matrix — run with `npm test`.
 * Validates registry + enforcement rules before/after V4_CATALOG_ENABLED deploy.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_VERTICALS,
  CATALOG_VERSION,
  getSignupVerticals,
  getSignupUseCases,
  getVertical,
  serializePlatformCatalog,
} from '../src/platform/business-verticals.registry';
import { validateBusinessSetup } from '../src/platform/catalog-validation';
import { resolveTemplateSlug } from '../src/modules/workflows/business-workflow';
import { findGuidedTemplate } from '../src/modules/workflows/business-workflow-templates';
import { getV4FeatureFlags } from '../src/platform/v4-feature-flags';

const ACTIVE_WORKFLOW_KEYS = [
  'salon',
  'clinic',
  'coaching',
  'real_estate',
  'ca_accountant',
  'travel',
  'local_shop',
];

const DEPRECATED_KEYS = ['farmer', 'insurance', 'support', 'other'];

describe('Release A — catalog v2 matrix', () => {
  it('serializes catalog version 2 with salon vertical', () => {
    const catalog = serializePlatformCatalog();
    assert.equal(catalog.version, 2);
    assert.equal(CATALOG_VERSION, 2);
    const salon = catalog.verticals.find((v) => v.key === 'salon');
    assert.ok(salon);
    assert.deepEqual(salon?.allowed_use_cases, ['appointment_booking']);
    assert.equal(salon?.max_use_cases, 1);
  });

  it('exposes 7 workflow signup verticals plus CareerAI plugin', () => {
    const signup = getSignupVerticals().map((v) => v.key).sort();
    assert.deepEqual(signup, [...ACTIVE_WORKFLOW_KEYS, 'career_ai'].sort());
    for (const key of DEPRECATED_KEYS) {
      assert.ok(!signup.includes(key), `${key} should be hidden from signup`);
    }
  });

  it('exposes only 3 active signup use cases', () => {
    assert.deepEqual(
      getSignupUseCases().map((u) => u.key).sort(),
      ['appointment_booking', 'customer_support', 'lead_generation'],
    );
  });

  it('keeps deprecated verticals in full registry for legacy tenants', () => {
    for (const key of DEPRECATED_KEYS) {
      assert.ok(getVertical(key), key);
    }
    assert.equal(BUSINESS_VERTICALS.length, 12);
  });
});

describe('Release A — setup enforcement (flag on)', () => {
  const origCatalog = process.env.V4_CATALOG_ENABLED;

  afterEach(() => {
    if (origCatalog === undefined) delete process.env.V4_CATALOG_ENABLED;
    else process.env.V4_CATALOG_ENABLED = origCatalog;
  });

  beforeEach(() => {
    process.env.V4_CATALOG_ENABLED = 'true';
  });

  const happyPaths: Array<{ vertical: string; useCases: string[] }> = [
    { vertical: 'salon', useCases: ['appointment_booking'] },
    { vertical: 'clinic', useCases: ['appointment_booking'] },
    { vertical: 'clinic', useCases: ['customer_support'] },
    { vertical: 'coaching', useCases: ['lead_generation', 'appointment_booking'] },
    { vertical: 'real_estate', useCases: ['lead_generation'] },
    { vertical: 'travel', useCases: ['appointment_booking'] },
    { vertical: 'local_shop', useCases: ['lead_generation'] },
    { vertical: 'ca_accountant', useCases: ['appointment_booking'] },
  ];

  for (const { vertical, useCases } of happyPaths) {
    it(`allows ${vertical} + [${useCases.join(', ')}]`, () => {
      assert.equal(
        validateBusinessSetup({ businessCategory: vertical, useCases }),
        null,
      );
    });
  }

  it('rejects salon with 2 use cases (over max)', () => {
    const result = validateBusinessSetup({
      businessCategory: 'salon',
      useCases: ['appointment_booking', 'lead_generation'],
    });
    assert.ok(result);
    assert.ok(result!.errors.use_cases?.length);
  });

  it('rejects new signup on farmer', () => {
    assert.ok(
      validateBusinessSetup({
        businessCategory: 'farmer',
        useCases: ['faq_bot'],
      }),
    );
  });

  it('grandfathers farmer tenant re-setup', () => {
    assert.equal(
      validateBusinessSetup({
        businessCategory: 'farmer',
        useCases: ['faq_bot'],
        currentCategory: 'farmer',
      }),
      null,
    );
  });

  it('rejects deprecated use case on new clinic signup', () => {
    assert.ok(
      validateBusinessSetup({
        businessCategory: 'clinic',
        useCases: ['faq_bot'],
      }),
    );
  });
});

describe('Release A — salon E2E template path', () => {
  it('resolves salon appointment to guided salon-appointment template', () => {
    assert.equal(resolveTemplateSlug('salon', 'appointment_booking'), 'salon-appointment');
    const template = findGuidedTemplate('salon-appointment');
    assert.ok(template);
    assert.equal(template?.name, 'Salon Appointment Booking');
  });
});

describe('Release A — feature flags default (pre-deploy)', () => {
  const origCatalog = process.env.V4_CATALOG_ENABLED;
  const origAvailability = process.env.V4_AVAILABILITY_ENABLED;

  afterEach(() => {
    if (origCatalog === undefined) delete process.env.V4_CATALOG_ENABLED;
    else process.env.V4_CATALOG_ENABLED = origCatalog;
    if (origAvailability === undefined) delete process.env.V4_AVAILABILITY_ENABLED;
    else process.env.V4_AVAILABILITY_ENABLED = origAvailability;
  });

  beforeEach(() => {
    delete process.env.V4_CATALOG_ENABLED;
    delete process.env.V4_AVAILABILITY_ENABLED;
  });

  it('defaults catalog enforcement off until Phase 4 deploy', () => {
    assert.equal(getV4FeatureFlags().v4_catalog_enabled, false);
    assert.equal(
      validateBusinessSetup({
        businessCategory: 'farmer',
        useCases: ['faq_bot'],
      }),
      null,
    );
  });
});
