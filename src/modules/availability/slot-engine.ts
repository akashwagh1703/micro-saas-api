import { localDateStrInTimeZone, zonedLocalDateTimeToUtc } from './timezone.util';

export interface TimeSlot {
  starts_at: string;
  ends_at: string;
}

export interface ScheduleWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isActive: boolean;
}

export interface BookingWindow {
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'confirmed']);

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function bookingsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function generateAvailableSlots(
  dateStr: string,
  timeZone: string,
  schedule: Pick<ScheduleWindow, 'startTime' | 'endTime' | 'slotMinutes'>,
  bookings: BookingWindow[],
): TimeSlot[] {
  const startMin = parseTimeToMinutes(schedule.startTime);
  const endMin = parseTimeToMinutes(schedule.endTime);
  const slotMinutes = schedule.slotMinutes;
  if (slotMinutes < 1 || endMin <= startMin) return [];

  const active = bookings.filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status));
  const slots: TimeSlot[] = [];

  for (let cursor = startMin; cursor + slotMinutes <= endMin; cursor += slotMinutes) {
    const startTime = minutesToTime(cursor);
    const endTime = minutesToTime(cursor + slotMinutes);
    const startsAt = zonedLocalDateTimeToUtc(dateStr, startTime, timeZone);
    const endsAt = zonedLocalDateTimeToUtc(dateStr, endTime, timeZone);

    const taken = active.some((b) => bookingsOverlap(startsAt, endsAt, b.startsAt, b.endsAt));
    if (!taken) {
      slots.push({
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
    }
  }

  return slots;
}

/** When booking for today, drop slots that start at or before `now`. */
export function filterFutureSlotsForToday(
  slots: TimeSlot[],
  dateStr: string,
  timeZone: string,
  now: Date = new Date(),
): TimeSlot[] {
  if (localDateStrInTimeZone(now, timeZone) !== dateStr) {
    return slots;
  }
  return slots.filter((slot) => new Date(slot.starts_at) > now);
}

export function pickScheduleForDay(
  schedules: ScheduleWindow[],
  dayOfWeek: number,
): ScheduleWindow | null {
  const match = schedules.find((s) => s.isActive && s.dayOfWeek === dayOfWeek);
  return match ?? null;
}
