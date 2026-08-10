import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCatalogSalesAnalytics,
  resolveCatalogAnalyticsDays,
} from '../src/modules/catalog/catalog-sales-analytics.util';

describe('Catalog sales analytics', () => {
  it('clamps days to 1..90', () => {
    assert.equal(resolveCatalogAnalyticsDays('7'), 7);
    assert.equal(resolveCatalogAnalyticsDays('999'), 90);
    assert.equal(resolveCatalogAnalyticsDays('0'), 1);
    assert.equal(resolveCatalogAnalyticsDays(undefined), 30);
  });

  it('sums paid income and builds top products', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const result = aggregateCatalogSalesAnalytics(
      7,
      [
        {
          orderStatus: 'delivered',
          amountInr: 500,
          productId: 1,
          productName: 'Mug',
          createdAt: today,
        },
        {
          orderStatus: 'ready_to_ship',
          amountInr: 300,
          productId: 1,
          productName: 'Mug',
          createdAt: today,
        },
        {
          orderStatus: 'pending_verification',
          amountInr: 200,
          productId: 2,
          productName: 'Shirt',
          createdAt: today,
        },
        {
          orderStatus: 'pending_payment',
          amountInr: 100,
          productId: 2,
          productName: 'Shirt',
          createdAt: today,
        },
        {
          orderStatus: 'rejected',
          amountInr: 50,
          productId: 3,
          productName: 'Cap',
          createdAt: today,
        },
      ],
      [],
    );

    assert.equal(result.summary.orders_total, 5);
    assert.equal(result.summary.orders_paid, 2);
    assert.equal(result.summary.revenue_paid_inr, 800);
    assert.equal(result.summary.revenue_pending_verification_inr, 200);
    assert.equal(result.summary.revenue_awaiting_payment_inr, 100);
    assert.equal(result.summary.avg_order_value_inr, 400);
    assert.equal(result.top_products[0]?.product_name, 'Mug');
    assert.equal(result.top_products[0]?.revenue_inr, 800);
    assert.equal(result.series.length, 7);
  });
});
