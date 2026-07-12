/**
 * Release B (Phase 10) availability + booking matrix — run with `npm test`.
 * Validates slot engine, salon workflow template, dashboard stats, and feature flags.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingsOverlap,
  generateAvailableSlots,
} from '../src/modules/availability/slot-engine';
import { zonedLocalDateTimeToUtc } from '../src/modules/availability/timezone.util';
import { resolveTemplateSlug } from '../src/modules/workflows/business-workflow';
import { findGuidedTemplate } from '../src/modules/workflows/business-workflow-templates';
import { getV4FeatureFlags } from '../src/platform/v4-feature-flags';
import { todayDateStrInTimezone } from '../src/modules/dashboard/dashboard-booking-stats';
import { normalizePreferredDate } from '../src/modules/workflows/nodes/booking-node.helpers';

const TZ = 'Asia/Kolkata';

describe('Release B — salon booking workflow template', () => {
  it('resolves salon appointment slug and uses live booking nodes', () => {
    assert.equal(resolveTemplateSlug('salon', 'appointment_booking'), 'salon-appointment');
    const template = findGuidedTemplate('salon-appointment');
    assert.ok(template);
    const nodeTypes = (template?.definition.nodes ?? []).map((n) => n.type);
    assert.ok(nodeTypes.includes('pick_options'));
    assert.ok(nodeTypes.includes('list_resources'));
    assert.ok(nodeTypes.includes('list_slots'));
    assert.ok(nodeTypes.includes('book_slot'));
    assert.ok(!nodeTypes.includes('collect_input'), 'Salon flow uses tap-to-pick instead of free-text');
    assert.ok(nodeTypes.includes('ai'), 'AI generates confirmation after booking');
    assert.equal(nodeTypes[1], 'pick_options', 'First reply is service action buttons');
  });
});

describe('Release B — slot engine (double-book + timezone)', () => {
  const schedule = { startTime: '09:00', endTime: '10:00', slotMinutes: 30 };

  it('rejects overlapping slot windows', () => {
    const aStart = zonedLocalDateTimeToUtc('2026-07-14', '09:00', TZ);
    const aEnd = zonedLocalDateTimeToUtc('2026-07-14', '09:30', TZ);
    const bStart = zonedLocalDateTimeToUtc('2026-07-14', '09:15', TZ);
    const bEnd = zonedLocalDateTimeToUtc('2026-07-14', '09:45', TZ);
    assert.equal(bookingsOverlap(aStart, aEnd, bStart, bEnd), true);
  });

  it('hides booked slot and restores after cancel', () => {
    const bookedStart = zonedLocalDateTimeToUtc('2026-07-14', '09:00', TZ);
    const bookedEnd = zonedLocalDateTimeToUtc('2026-07-14', '09:30', TZ);
    const withBooking = generateAvailableSlots('2026-07-14', TZ, schedule, [
      { startsAt: bookedStart, endsAt: bookedEnd, status: 'confirmed' },
    ]);
    assert.equal(withBooking.length, 1);

    const afterCancel = generateAvailableSlots('2026-07-14', TZ, schedule, [
      { startsAt: bookedStart, endsAt: bookedEnd, status: 'cancelled' },
    ]);
    assert.equal(afterCancel.length, 2);
  });

  it('salon 3-barber scenario keeps independent availability', () => {
    const bookedStart = zonedLocalDateTimeToUtc('2026-07-14', '09:00', TZ);
    const bookedEnd = zonedLocalDateTimeToUtc('2026-07-14', '09:30', TZ);
    const barber2Only = generateAvailableSlots('2026-07-14', TZ, schedule, [
      { startsAt: bookedStart, endsAt: bookedEnd, status: 'confirmed' },
    ]);
    const barber1 = generateAvailableSlots('2026-07-14', TZ, schedule, []);
    assert.equal(barber1.length, 2);
    assert.equal(barber2Only.length, 1);
  });
});

describe('Release B — booking workflow helpers', () => {
  it('parses customer date replies for list_slots', () => {
    const ref = new Date(2026, 6, 12);
    assert.equal(normalizePreferredDate('tomorrow', ref), '2026-07-13');
    assert.equal(normalizePreferredDate('2026-07-20', ref), '2026-07-20');
  });
});

describe('Release B — dashboard booking stats', () => {
  it('computes local today in tenant timezone', () => {
    const today = todayDateStrInTimezone('Asia/Kolkata', new Date('2026-07-12T10:00:00.000Z'));
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Release B — feature flags (deploy target)', () => {
  const origCatalog = process.env.V4_CATALOG_ENABLED;
  const origAvailability = process.env.V4_AVAILABILITY_ENABLED;

  afterEach(() => {
    if (origCatalog === undefined) delete process.env.V4_CATALOG_ENABLED;
    else process.env.V4_CATALOG_ENABLED = origCatalog;
    if (origAvailability === undefined) delete process.env.V4_AVAILABILITY_ENABLED;
    else process.env.V4_AVAILABILITY_ENABLED = origAvailability;
  });

  it('defaults availability off until Release B deploy', () => {
    delete process.env.V4_AVAILABILITY_ENABLED;
    assert.equal(getV4FeatureFlags().v4_availability_enabled, false);
  });

  it('parses V4_AVAILABILITY_ENABLED=true for Release B', () => {
    process.env.V4_AVAILABILITY_ENABLED = 'true';
    assert.equal(getV4FeatureFlags().v4_availability_enabled, true);
  });
});
