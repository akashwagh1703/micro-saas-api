/**
 * Catalog commerce Phase 6 — hardening checks (run with `npm test`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findGuidedTemplate } from '../src/modules/workflows/business-workflow-templates';
import {
  canClaimStockDecrement,
  isCatalogCommerceWorkflowDefinitionCurrent,
} from '../src/modules/workflows/catalog-commerce-workflow';
import { serializePublicCatalog } from '../src/modules/catalog/catalog.serializer';
import { CATALOG_WA_PRODUCTS_PER_PAGE } from '../src/modules/catalog/catalog-order.constants';

describe('Catalog commerce Phase 6 — template + upgrade fingerprint', () => {
  it('catalog-share template is the commerce shop graph', () => {
    const template = findGuidedTemplate('catalog-share');
    assert.ok(template);
    assert.equal(
      isCatalogCommerceWorkflowDefinitionCurrent(template!.definition),
      true,
    );

    const nodes = template!.definition.nodes ?? [];
    const types = new Set(nodes.map((n) => n.type));
    assert.ok(types.has('list_catalog_categories'));
    assert.ok(types.has('list_catalog_products'));
    assert.ok(types.has('create_catalog_order'));
    assert.ok(types.has('collect_payment_screenshot'));
    assert.ok(!nodes.some((n) => n.id === 'save-lead-order'));
    assert.ok(!nodes.some((n) => n.id === 'send-image-1'));
    assert.ok(nodes.some((n) => n.id === 'list-catalog-categories'));

    const menu = nodes.find((n) => n.id === 'pick-menu');
    const options = Array.isArray(menu?.data?.options) ? menu!.data!.options : [];
    assert.ok(options.some((o: { value?: string }) => o.value === 'website'));
    assert.ok(
      options.some(
        (o: { value?: string; next_node_id?: string }) =>
          o.value === 'catalog' && o.next_node_id === 'list-catalog-categories',
      ),
    );
    assert.ok(!options.some((o: { value?: string }) => o.value === 'order'));
  });

  it('rejects legacy brochure/lead fingerprint as current', () => {
    const legacy = {
      nodes: [
        { id: 'pick-menu', type: 'pick_options', data: { options: [{ text: 'Catalog', value: 'catalog' }, { text: 'Website', value: 'website' }, { text: 'Order', value: 'order' }] } },
        { id: 'send-image-1', type: 'send_message', data: {} },
        { id: 'save-lead-order', type: 'save_lead', data: {} },
      ],
      edges: [],
    };
    assert.equal(isCatalogCommerceWorkflowDefinitionCurrent(legacy as any), false);
  });
});

describe('Catalog commerce Phase 6 — stock race helpers', () => {
  it('allows claim when stock covers quantity', () => {
    assert.equal(canClaimStockDecrement(1, 1), true);
    assert.equal(canClaimStockDecrement(5, 1), true);
  });

  it('blocks last-item oversell (concurrent second claim)', () => {
    let stock = 1;
    const q = 1;
    const first = canClaimStockDecrement(stock, q);
    assert.equal(first, true);
    if (first) stock -= q;
    const second = canClaimStockDecrement(stock, q);
    assert.equal(second, false);
    assert.equal(stock, 0);
  });

  it('page size stays at 5 (Phase 0 D4)', () => {
    assert.equal(CATALOG_WA_PRODUCTS_PER_PAGE, 5);
  });
});

describe('Catalog commerce Phase 6 — public payload isolation', () => {
  it('public catalog serializer omits merchant payment QR', () => {
    const site = {
      id: 1,
      userId: 9,
      slug: 'demo-shop',
      businessName: 'Demo Shop',
      tagline: null,
      status: 'published',
      theme: null,
      contactPhone: null,
      contactEmail: null,
      contactWhatsapp: null,
      address: null,
      publishedAt: new Date(),
      paymentQrMediaId: 42,
      paymentUpiVpa: 'shop@upi',
      paymentUpiPayeeName: 'Demo',
      paymentsEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      sections: [],
      media: [
        {
          id: 42,
          siteId: 1,
          sectionId: null,
          kind: 'image',
          storageKey: 'x',
          url: 'https://example.com/qr.png',
          fileName: 'qr.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          alt: 'QR',
          sortOrder: 0,
          createdAt: new Date(),
        },
      ],
      products: [],
    };

    const pub = serializePublicCatalog(site as any, 'https://example.com', (id) => `https://example.com/m/${id}`);
    assert.equal('payment' in pub, false);
    assert.equal((pub as any).payment, undefined);
    assert.equal(pub.slug, 'demo-shop');
  });
});
