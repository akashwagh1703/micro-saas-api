import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionLifecycleService } from '../src/modules/billing/subscription-lifecycle.service';

function makeService() {
  return new SubscriptionLifecycleService(
    { get: () => 'true' } as any,
    {} as any,
    { isSuperAdmin: () => false } as any,
    {} as any,
  );
}

describe('SubscriptionLifecycleService windows', () => {
  const svc = makeService();
  const now = new Date('2026-07-20T12:00:00.000Z');

  it('prefers paid period over trial when active', () => {
    const periodEnd = new Date('2026-08-01T00:00:00.000Z');
    const window = svc.resolveAccessWindow(
      {
        id: 1,
        name: 'A',
        email: 'a@test.com',
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
        currentPeriodEnd: periodEnd,
        subscriptionStatus: 'active',
        billingExpiringNotifiedFor: null,
        billingExpiredNotifiedFor: null,
      },
      now,
    );
    assert.equal(window?.kind, 'subscription');
    assert.equal(window?.endsAt.toISOString(), periodEnd.toISOString());
  });

  it('uses trial when still open and not in paid window', () => {
    const trialEnds = new Date('2026-07-25T00:00:00.000Z');
    const window = svc.resolveAccessWindow(
      {
        id: 2,
        name: 'B',
        email: 'b@test.com',
        trialEndsAt: trialEnds,
        currentPeriodEnd: null,
        subscriptionStatus: 'trial',
        billingExpiringNotifiedFor: null,
        billingExpiredNotifiedFor: null,
      },
      now,
    );
    assert.equal(window?.kind, 'trial');
    assert.equal(window?.endsAt.toISOString(), trialEnds.toISOString());
  });

  it('detects expired trial end', () => {
    const trialEnds = new Date('2026-07-10T00:00:00.000Z');
    const ended = svc.resolveExpiredAt(
      {
        id: 3,
        name: 'C',
        email: 'c@test.com',
        trialEndsAt: trialEnds,
        currentPeriodEnd: null,
        subscriptionStatus: 'trial',
        billingExpiringNotifiedFor: null,
        billingExpiredNotifiedFor: null,
      },
      now,
    );
    assert.equal(ended?.kind, 'trial');
    assert.equal(ended?.endsAt.toISOString(), trialEnds.toISOString());
  });
});
