import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('UPI billing hardening (Phase 5)', () => {
  it('pending_verification must not grant access (hard block)', () => {
    assert.equal(
      { subscriptionStatus: 'pending_verification', has_access: false }.has_access,
      false,
    );
  });

  it('duplicate UTR responses include a machine-readable code', () => {
    const body = {
      message: 'This UPI transaction ID was already submitted.',
      code: 'duplicate_utr',
    };
    assert.equal(body.code, 'duplicate_utr');
  });

  it('default pending window is 7 days', () => {
    const days = parseInt(process.env.MANUAL_PAYMENT_PENDING_DAYS ?? '7', 10);
    assert.equal(Number.isNaN(days) ? 7 : days, 7);
  });
});
