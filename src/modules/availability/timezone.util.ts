export const DEFAULT_TENANT_TIMEZONE = 'Asia/Kolkata';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour') % 24,
    minute: pick('minute'),
  };
}

/** Converts a local calendar date + HH:mm in an IANA timezone to a UTC Date. */
export function zonedLocalDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 6; attempt++) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const dayDelta = parts.day - day;
    const diffMinutes =
      dayDelta * 24 * 60 + (parts.hour - hour) * 60 + (parts.minute - minute);
    if (
      diffMinutes === 0 &&
      parts.year === year &&
      parts.month === month &&
      parts.day === day
    ) {
      return new Date(utc);
    }
    utc -= diffMinutes * 60 * 1000;
  }

  return new Date(utc);
}

/** Returns 0=Sun .. 6=Sat for YYYY-MM-DD in the given timezone. */
export function dayOfWeekForDate(dateStr: string, timeZone: string): number {
  const noonUtc = zonedLocalDateTimeToUtc(dateStr, '12:00', timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(noonUtc);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

export function utcDayRangeForLocalDate(
  dateStr: string,
  timeZone: string,
): { dayStartUtc: Date; dayEndUtc: Date } {
  const dayStartUtc = zonedLocalDateTimeToUtc(dateStr, '00:00', timeZone);
  const nextDate = addDaysToDateStr(dateStr, 1);
  const dayEndUtc = zonedLocalDateTimeToUtc(nextDate, '00:00', timeZone);
  return { dayStartUtc, dayEndUtc };
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function isValidDateStr(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`));
}

export function isValidTimeStr(timeStr: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
}
