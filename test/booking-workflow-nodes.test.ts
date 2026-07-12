import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookingMessageContext,
  formatSlotLabel,
  normalizePreferredDate,
  substituteContext,
  DEFAULT_BOOKING_CONFIRMED_MESSAGE,
} from '../src/modules/workflows/nodes/booking-node.helpers';

describe('booking workflow helpers', () => {
  it('normalizes today, tomorrow, and ISO dates', () => {
    const ref = new Date(2026, 6, 12);
    assert.equal(normalizePreferredDate('today', ref), '2026-07-12');
    assert.equal(normalizePreferredDate('tomorrow', ref), '2026-07-13');
    assert.equal(normalizePreferredDate('2026-07-20', ref), '2026-07-20');
  });

  it('parses day/month shorthand dates', () => {
    const ref = new Date(2026, 6, 12);
    assert.equal(normalizePreferredDate('15/07', ref), '2026-07-15');
  });

  it('returns null for unparseable dates', () => {
    assert.equal(normalizePreferredDate('sometime soon'), null);
  });

  it('substitutes context variables in templates', () => {
    const message = substituteContext('Hello {{contact_name}}, stylist {{resource_name}}', {
      contact_name: 'Riya',
      resource_name: 'Rahul',
    });
    assert.equal(message, 'Hello Riya, stylist Rahul');
  });

  it('formats slot labels in tenant timezone', () => {
    const label = formatSlotLabel('2026-07-14T08:30:00.000Z', 'Asia/Kolkata');
    assert.match(label, /Jul/);
    assert.match(label, /14/);
  });

  it('builds booking confirmation message from workflow template variables', () => {
    const ctx = buildBookingMessageContext({
      businessName: 'City Care Clinic',
      contactName: 'Amit',
      resourceName: 'Dr. Mehta',
      serviceType: 'General visit',
      bookingTime: 'Mon, Jul 14, 2:00 pm',
      bookingId: 42,
    });
    const message = substituteContext(DEFAULT_BOOKING_CONFIRMED_MESSAGE, ctx);
    assert.match(message, /City Care Clinic/);
    assert.match(message, /Dr\. Mehta/);
    assert.match(message, /General visit/);
    assert.match(message, /Appointment confirmed/);
  });
});
