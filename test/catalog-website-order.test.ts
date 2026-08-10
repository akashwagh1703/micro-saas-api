/**
 * Website → WhatsApp order deep-link parsing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWebsiteOrderWhatsAppText,
  parseWebsiteCatalogOrderProductId,
} from '../src/modules/catalog/catalog-website-order.util';

describe('Catalog website order deep link', () => {
  it('parses product id from professional buy message', () => {
    const text = buildWebsiteOrderWhatsAppText({
      id: 42,
      name: 'Gold Package',
      price_amount: 999,
      price_currency: 'INR',
      description: 'Premium kit',
    });
    assert.match(text, /I would like to buy/i);
    assert.match(text, /AW_PRODUCT_ID:42/);
    assert.equal(parseWebsiteCatalogOrderProductId(text), 42);
  });

  it('rejects unrelated messages', () => {
    assert.equal(parseWebsiteCatalogOrderProductId('hi'), null);
    assert.equal(parseWebsiteCatalogOrderProductId('book appointment'), null);
  });
});
