import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, localTime, weekday, weekStart, weekDates } from '../src/domain/dates.ts';

test('weekday and week start (weeks start on Monday)', () => {
  assert.equal(weekday('2026-10-26'), 0); // Monday
  assert.equal(weekday('2026-11-01'), 6); // Sunday
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
});

test('date arithmetic across month, year and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-01', '2026-11-02'), 1); // US DST ends Nov 1, still one day
  assert.deepEqual(weekDates('2026-10-26').slice(-1), ['2026-11-01']);
});

test('local time in the house time zone', () => {
  const t = localTime('America/New_York', new Date('2026-10-27T03:30:00Z'));
  assert.deepEqual(t, { date: '2026-10-26', hour: 23, minute: 30 });
});

test('invalid dates are rejected', () => {
  assert.throws(() => addDays('2026-02-30', 1));
  assert.throws(() => addDays('next tuesday', 1));
});
