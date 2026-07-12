import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ACTIVE_BOOKING_STATUSES } from '../availability/slot-engine';
import { DEFAULT_TENANT_TIMEZONE, utcDayRangeForLocalDate } from '../availability/timezone.util';

export interface BookingDashboardStats {
  bookings_today: number;
  bookings_upcoming: number;
  resources_active: number;
}

/** Local calendar date (YYYY-MM-DD) in the tenant IANA timezone. */
export function todayDateStrInTimezone(timeZone: string, reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

export async function computeBookingDashboardStats(
  prisma: PrismaService,
  settings: SettingsService,
  userId: number,
): Promise<BookingDashboardStats> {
  const tz = (await settings.get(userId, 'timezone')) || DEFAULT_TENANT_TIMEZONE;
  const todayStr = todayDateStrInTimezone(tz);
  const { dayStartUtc, dayEndUtc } = utcDayRangeForLocalDate(todayStr, tz);
  const activeStatuses = [...ACTIVE_BOOKING_STATUSES];

  const [bookingsToday, bookingsUpcoming, resourcesActive] = await prisma.$transaction([
    prisma.booking.count({
      where: {
        userId,
        status: { in: activeStatuses },
        startsAt: { gte: dayStartUtc, lt: dayEndUtc },
      },
    }),
    prisma.booking.count({
      where: {
        userId,
        status: { in: activeStatuses },
        startsAt: { gte: dayEndUtc },
      },
    }),
    prisma.serviceResource.count({
      where: { userId, isActive: true },
    }),
  ]);

  return {
    bookings_today: bookingsToday,
    bookings_upcoming: bookingsUpcoming,
    resources_active: resourcesActive,
  };
}
