// Trash runs as one continuous cycle through the house, one person per day:
// person 1, 2, ... 6, then person 1 again on day 7. Because a week has 7
// days and the cycle has 6 people, each week starts one person later, and
// each week one person has two trash days. Over 6 weeks everyone gets that
// double week exactly once.
//
// If someone is away on their day, the next person in the cycle who is home
// covers it and earns the point. The away person keeps their place, so the
// order never drifts.

import { daysBetween, weekDates, type ISODate } from './dates.ts';

export interface TrashDay {
  date: ISODate;
  /** Whose turn it is in the cycle. */
  scheduledId: number;
  /** Who actually does it (differs when covering), or null if everyone is away. */
  memberId: number | null;
}

export function scheduledFor(order: number[], cycleStart: ISODate, date: ISODate): number {
  if (order.length === 0) throw new Error('trash cycle has no members');
  const n = order.length;
  const idx = ((daysBetween(cycleStart, date) % n) + n) % n;
  return order[idx];
}

export function coverFor(order: number[], scheduledId: number, isAway: (memberId: number) => boolean): number | null {
  const start = order.indexOf(scheduledId);
  for (let k = 0; k < order.length; k++) {
    const candidate = order[(start + k) % order.length];
    if (!isAway(candidate)) return candidate;
  }
  return null;
}

export function planTrashWeek(
  order: number[],
  cycleStart: ISODate,
  weekStartDate: ISODate,
  isAway: (memberId: number, date: ISODate) => boolean,
): TrashDay[] {
  return weekDates(weekStartDate).map((date) => {
    const scheduledId = scheduledFor(order, cycleStart, date);
    return { date, scheduledId, memberId: coverFor(order, scheduledId, (id) => isAway(id, date)) };
  });
}
