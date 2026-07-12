import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { todayDateStrInTimezone } from '../src/modules/dashboard/dashboard-booking-stats';

describe('dashboard booking stats helpers', () => {
  it('formats today in Asia/Kolkata as YYYY-MM-DD', () => {
    const ref = new Date('2026-07-12T10:30:00.000Z');
    const today = todayDateStrInTimezone('Asia/Kolkata', ref);
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats today in UTC', () => {
    const ref = new Date('2026-07-12T15:00:00.000Z');
    const today = todayDateStrInTimezone('UTC', ref);
    assert.equal(today, '2026-07-12');
  });
});
