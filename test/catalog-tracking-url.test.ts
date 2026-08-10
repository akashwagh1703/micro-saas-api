import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourierTrackingUrl } from '../src/modules/catalog/catalog-tracking-url.util';

describe('Catalog tracking URL', () => {
  it('builds Delhivery tracking link', () => {
    const url = buildCourierTrackingUrl('Delhivery', 'ABC123');
    assert.match(String(url), /delhivery/i);
    assert.match(String(url), /ABC123/);
  });

  it('falls back to Google search when courier unknown', () => {
    const url = buildCourierTrackingUrl('Local Courier', 'XYZ');
    assert.match(String(url), /google\.com\/search/);
  });
});
