import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getV4FeatureFlags,
  isV4CatalogEnabled,
  isV4AvailabilityEnabled,
} from '../src/platform/v4-feature-flags';

describe('v4 feature flags', () => {
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

  it('defaults both flags to false', () => {
    assert.deepEqual(getV4FeatureFlags(), {
      v4_catalog_enabled: false,
      v4_availability_enabled: false,
    });
    assert.equal(isV4CatalogEnabled(), false);
    assert.equal(isV4AvailabilityEnabled(), false);
  });

  it('parses true for catalog', () => {
    process.env.V4_CATALOG_ENABLED = 'true';
    assert.equal(isV4CatalogEnabled(), true);
    assert.equal(isV4AvailabilityEnabled(), false);
  });

  it('parses 1 for availability', () => {
    process.env.V4_AVAILABILITY_ENABLED = '1';
    assert.equal(isV4AvailabilityEnabled(), true);
  });
});
