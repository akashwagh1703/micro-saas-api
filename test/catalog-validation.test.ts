import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateBusinessSetup } from '../src/platform/catalog-validation';

describe('catalog validation (v4)', () => {
  const origCatalog = process.env.V4_CATALOG_ENABLED;

  afterEach(() => {
    if (origCatalog === undefined) delete process.env.V4_CATALOG_ENABLED;
    else process.env.V4_CATALOG_ENABLED = origCatalog;
  });

  beforeEach(() => {
    delete process.env.V4_CATALOG_ENABLED;
  });

  it('is a no-op when V4_CATALOG_ENABLED is false', () => {
    assert.equal(
      validateBusinessSetup({
        businessCategory: 'salon',
        useCases: ['lead_generation', 'appointment_booking'],
      }),
      null,
    );
  });

  describe('with V4_CATALOG_ENABLED=true', () => {
    beforeEach(() => {
      process.env.V4_CATALOG_ENABLED = 'true';
    });

    it('allows salon + appointment_booking', () => {
      assert.equal(
        validateBusinessSetup({
          businessCategory: 'salon',
          useCases: ['appointment_booking'],
        }),
        null,
      );
    });

    it('rejects salon with more than max_use_cases', () => {
      const result = validateBusinessSetup({
        businessCategory: 'salon',
        useCases: ['appointment_booking', 'lead_generation'],
      });
      assert.ok(result);
      assert.match(result!.message, /Salon/i);
      assert.ok(result!.errors.use_cases?.length);
    });

    it('rejects salon with disallowed use case', () => {
      const result = validateBusinessSetup({
        businessCategory: 'salon',
        useCases: ['lead_generation'],
      });
      assert.ok(result);
      assert.match(result!.errors.use_cases![0], /Appointment Booking/i);
    });

    it('allows coaching with lead + appointment (max 2)', () => {
      assert.equal(
        validateBusinessSetup({
          businessCategory: 'coaching',
          useCases: ['lead_generation', 'appointment_booking'],
        }),
        null,
      );
    });

    it('rejects deprecated vertical for new signup', () => {
      const result = validateBusinessSetup({
        businessCategory: 'farmer',
        useCases: ['faq_bot'],
      });
      assert.ok(result);
      assert.match(result!.message, /no longer available/i);
    });

    it('grandfathers existing tenant on same deprecated vertical', () => {
      assert.equal(
        validateBusinessSetup({
          businessCategory: 'farmer',
          useCases: ['faq_bot'],
          currentCategory: 'farmer',
        }),
        null,
      );
    });

    it('skips use-case rules for plugin verticals', () => {
      assert.equal(
        validateBusinessSetup({
          businessCategory: 'career_ai',
          useCases: [],
        }),
        null,
      );
    });
  });
});
