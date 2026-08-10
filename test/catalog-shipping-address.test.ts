import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShippingAddressMessage } from '../src/modules/catalog/catalog-shipping-address.util';

describe('Catalog shipping address parse', () => {
  it('parses labeled address reply', () => {
    const text = [
      'Name: Akash Wagh',
      'Address: 12 MG Road',
      'City: Pune',
      'State: Maharashtra',
      'Pincode: 411001',
      'Phone: 9876543210',
    ].join('\n');
    const parsed = parseShippingAddressMessage(text);
    assert.ok(parsed);
    assert.equal(parsed!.shipping_name, 'Akash Wagh');
    assert.equal(parsed!.shipping_address_line, '12 MG Road');
    assert.equal(parsed!.shipping_city, 'Pune');
    assert.equal(parsed!.shipping_pincode, '411001');
  });

  it('parses free-form with pincode', () => {
    const parsed = parseShippingAddressMessage('Flat 2, MG Road, Pune 411001');
    assert.ok(parsed);
    assert.equal(parsed!.shipping_pincode, '411001');
    assert.match(parsed!.shipping_address_line, /MG Road/);
  });

  it('rejects messages without pincode', () => {
    assert.equal(parseShippingAddressMessage('hello please ship soon'), null);
  });
});
