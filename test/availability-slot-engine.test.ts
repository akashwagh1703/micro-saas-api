import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingsOverlap,
  generateAvailableSlots,
  pickScheduleForDay,
} from '../src/modules/availability/slot-engine';
import { dayOfWeekForDate, zonedLocalDateTimeToUtc } from '../src/modules/availability/timezone.util';

const TZ = 'Asia/Kolkata';

describe('availability slot engine', () => {
  const mondaySchedule = {
    startTime: '09:00',
    endTime: '11:00',
    slotMinutes: 30,
  };

  it('generates 30-minute slots for a 2-hour window', () => {
    const slots = generateAvailableSlots('2026-07-13', TZ, mondaySchedule, []);
    assert.equal(slots.length, 4);
    assert.equal(slots[0].starts_at, zonedLocalDateTimeToUtc('2026-07-13', '09:00', TZ).toISOString());
    assert.equal(slots[3].starts_at, zonedLocalDateTimeToUtc('2026-07-13', '10:30', TZ).toISOString());
  });

  it('excludes a booked slot from availability', () => {
    const bookedStart = zonedLocalDateTimeToUtc('2026-07-13', '09:30', TZ);
    const bookedEnd = zonedLocalDateTimeToUtc('2026-07-13', '10:00', TZ);
    const slots = generateAvailableSlots('2026-07-13', TZ, mondaySchedule, [
      { startsAt: bookedStart, endsAt: bookedEnd, status: 'confirmed' },
    ]);
    assert.equal(slots.length, 3);
    assert.ok(!slots.some((s) => s.starts_at === bookedStart.toISOString()));
  });

  it('restores slot when booking is cancelled', () => {
    const bookedStart = zonedLocalDateTimeToUtc('2026-07-13', '09:30', TZ);
    const bookedEnd = zonedLocalDateTimeToUtc('2026-07-13', '10:00', TZ);
    const slots = generateAvailableSlots('2026-07-13', TZ, mondaySchedule, [
      { startsAt: bookedStart, endsAt: bookedEnd, status: 'cancelled' },
    ]);
    assert.equal(slots.length, 4);
  });

  it('detects overlapping bookings', () => {
    const aStart = new Date('2026-07-13T04:00:00.000Z');
    const aEnd = new Date('2026-07-13T04:30:00.000Z');
    const bStart = new Date('2026-07-13T04:15:00.000Z');
    const bEnd = new Date('2026-07-13T04:45:00.000Z');
    assert.equal(bookingsOverlap(aStart, aEnd, bStart, bEnd), true);
    assert.equal(
      bookingsOverlap(aStart, aEnd, new Date('2026-07-13T04:30:00.000Z'), new Date('2026-07-13T05:00:00.000Z')),
      false,
    );
  });

  it('picks schedule for day of week', () => {
    const schedules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', slotMinutes: 30, isActive: true },
      { dayOfWeek: 0, startTime: '10:00', endTime: '14:00', slotMinutes: 30, isActive: false },
    ];
    assert.equal(dayOfWeekForDate('2026-07-13', TZ), 1);
    const picked = pickScheduleForDay(schedules, 1);
    assert.ok(picked);
    assert.equal(picked?.startTime, '09:00');
  });

  it('salon with 3 barbers returns independent slot lists', () => {
    const barberBookings = [
      [],
      [{ startsAt: zonedLocalDateTimeToUtc('2026-07-14', '09:00', TZ), endsAt: zonedLocalDateTimeToUtc('2026-07-14', '09:30', TZ), status: 'confirmed' }],
      [],
    ];
    const results = barberBookings.map((bookings) =>
      generateAvailableSlots('2026-07-14', TZ, { startTime: '09:00', endTime: '10:00', slotMinutes: 30 }, bookings),
    );
    assert.deepEqual(results.map((r) => r.length), [2, 1, 2]);
  });
});
