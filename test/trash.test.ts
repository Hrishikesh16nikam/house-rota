import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrashWeek, scheduledFor } from '../src/domain/trash.ts';
import { addDays, weekDates } from '../src/domain/dates.ts';

const order = [1, 2, 3, 4, 5, 6];
const start = '2026-10-26'; // a Monday
const never = () => false;

test('one person per day, and day 7 wraps back to person 1', () => {
  const week = planTrashWeek(order, start, start, never).map((d) => d.memberId);
  assert.deepEqual(week, [1, 2, 3, 4, 5, 6, 1]);
});

test('each week starts one person later', () => {
  const next = planTrashWeek(order, start, addDays(start, 7), never).map((d) => d.memberId);
  assert.deepEqual(next, [2, 3, 4, 5, 6, 1, 2]);
});

test('over 6 weeks everyone has exactly 7 trash days and one double week', () => {
  const totals = new Map<number, number>();
  const doubles = new Map<number, number>();
  for (let w = 0; w < 6; w++) {
    const week = planTrashWeek(order, start, addDays(start, 7 * w), never);
    const perWeek = new Map<number, number>();
    for (const d of week) {
      totals.set(d.memberId!, (totals.get(d.memberId!) ?? 0) + 1);
      perWeek.set(d.memberId!, (perWeek.get(d.memberId!) ?? 0) + 1);
    }
    for (const [id, n] of perWeek) if (n === 2) doubles.set(id, (doubles.get(id) ?? 0) + 1);
  }
  for (const id of order) {
    assert.equal(totals.get(id), 7, `member ${id}`);
    assert.equal(doubles.get(id), 1, `member ${id}`);
  }
});

test('an away member is covered by the next person home, and keeps their place', () => {
  const away = (id: number, date: string) => id === 3 && date === '2026-10-28';
  const week = planTrashWeek(order, start, start, away);
  assert.deepEqual(week[2], { date: '2026-10-28', scheduledId: 3, memberId: 4 });
  assert.equal(week[3].memberId, 4); // 4 still has their own day too
  assert.equal(scheduledFor(order, start, '2026-11-03'), 3); // the cycle didn't shift
});

test('nobody home means nobody assigned', () => {
  const week = planTrashWeek(order, start, start, () => true);
  assert.ok(week.every((d) => d.memberId === null));
  assert.equal(weekDates(start).length, week.length);
});
