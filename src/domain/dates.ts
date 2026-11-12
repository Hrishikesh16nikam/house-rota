// Calendar dates as "YYYY-MM-DD" strings in the house's local time zone.
// Working with whole days avoids daylight-saving surprises: a "day" is a
// calendar date, never 24 hours of milliseconds.

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toDayNumber(date: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`invalid date ${JSON.stringify(date)}, expected YYYY-MM-DD`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCDate() !== Number(m[3])) throw new RangeError(`invalid date ${date}`);
  return Math.round(ms / DAY_MS);
}

export function fromDayNumber(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Monday ... 6 = Sunday. (1970-01-01 was a Thursday.) */
export function weekday(date: ISODate): number {
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

/** The Monday on or before date. */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -weekday(date));
}

export function weekDates(start: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function isValidDate(date: unknown): date is ISODate {
  if (typeof date !== 'string') return false;
  try {
    toDayNumber(date);
    return true;
  } catch {
    return false;
  }
}

export interface LocalTime {
  date: ISODate;
  hour: number;
  minute: number;
}

/** The current wall-clock date and time in a time zone such as America/New_York. */
export function localTime(timeZone: string, now: Date = new Date()): LocalTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
