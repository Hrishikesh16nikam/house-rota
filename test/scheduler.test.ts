import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, type PlanInput } from '../src/domain/scheduler.ts';
import type { Duty, Member } from '../src/domain/types.ts';

// The house from the brief: 6 people, washroom A shared by 1-3, B by 4-6.
const members: Member[] = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `M${id}`, active: true, trashOrder: id }));
const duties: Duty[] = [
  { id: 10, name: 'Washroom A', kind: 'weekly', slots: 1, points: 4, eligible: [1, 2, 3] },
  { id: 11, name: 'Washroom B', kind: 'weekly', slots: 1, points: 4, eligible: [4, 5, 6] },
  { id: 12, name: 'Kitchen', kind: 'weekly', slots: 2, points: 3, eligible: null },
  { id: 13, name: 'Living room', kind: 'weekly', slots: 1, points: 2, eligible: null },
];

function input(over: Partial<PlanInput> = {}): PlanInput {
  return { members, duties, unavailable: new Set(), totals: new Map(), weeksSince: new Map(), ...over };
}

function byMember(plan: ReturnType<typeof planWeek>) {
  const m = new Map<number, number[]>();
  for (const s of plan.slots) if (s.memberId !== null) m.set(s.memberId, [...(m.get(s.memberId) ?? []), s.dutyId]);
  return m;
}

test('nobody gets two weekly duties when everyone is home', () => {
  const plan = planWeek(input());
  assert.equal(plan.slots.length, 5);
  assert.deepEqual(plan.doubled, []);
  for (const [, ds] of byMember(plan)) assert.equal(ds.length, 1);
  assert.equal(byMember(plan).size, 5); // exactly one person is free
});

test('washrooms only go to the people who use them', () => {
  for (let seed = 0; seed < 20; seed++) {
    const totals = new Map(members.map((m) => [m.id, (m.id * 7 + seed * 3) % 11]));
    const plan = planWeek(input({ totals }));
    const a = plan.slots.find((s) => s.dutyId === 10)!.memberId!;
    const b = plan.slots.find((s) => s.dutyId === 11)!.memberId!;
    assert.ok([1, 2, 3].includes(a), `washroom A went to ${a}`);
    assert.ok([4, 5, 6].includes(b), `washroom B went to ${b}`);
  }
});

test('the two kitchen slots always go to different people', () => {
  for (let seed = 0; seed < 20; seed++) {
    const totals = new Map(members.map((m) => [m.id, (m.id * 5 + seed) % 9]));
    const kitchen = planWeek(input({ totals })).slots.filter((s) => s.dutyId === 12);
    assert.notEqual(kitchen[0].memberId, kitchen[1].memberId);
  }
});

test('whoever is furthest ahead on points gets the week off', () => {
  // Member 2 has two trash days this week, so is ahead: they should be free.
  const totals = new Map([[1, 10], [2, 14], [3, 10], [4, 10], [5, 10], [6, 10]]);
  const plan = planWeek(input({ totals }));
  assert.ok(!byMember(plan).has(2));
});

test('heavier duties go to whoever is behind', () => {
  const totals = new Map([[1, 0], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9]]);
  const plan = planWeek(input({ totals }));
  assert.equal(plan.slots.find((s) => s.dutyId === 10)!.memberId, 1);
});

test('avoids repeating last week\'s duty', () => {
  const weeksSince = new Map([['1:10', 1], ['2:10', 1]]); // 1 and 2 did washroom A recently
  const totals = new Map(members.map((m) => [m.id, 10]));
  const plan = planWeek(input({ totals, weeksSince }));
  assert.equal(plan.slots.find((s) => s.dutyId === 10)!.memberId, 3);
});

test('one person away: still no doubles', () => {
  const plan = planWeek(input({ unavailable: new Set([5]) }));
  assert.deepEqual(plan.doubled, []);
  assert.ok(!byMember(plan).has(5));
  assert.equal(byMember(plan).size, 5);
});

test('two people away: exactly one person doubles up, chosen by points', () => {
  const totals = new Map([[1, 20], [2, 20], [3, 20], [4, 20], [5, 3], [6, 20]]);
  const plan = planWeek(input({ unavailable: new Set([1, 6]), totals }));
  assert.equal(plan.doubled.length, 1);
  assert.equal(plan.doubled[0], 5); // the person furthest behind
  assert.equal(plan.skipped.length, 0);
});

test('a washroom whose users are all away is skipped, not given to someone else', () => {
  const plan = planWeek(input({ unavailable: new Set([1, 2, 3]) }));
  assert.equal(plan.slots.find((s) => s.dutyId === 10)!.memberId, null);
  assert.equal(plan.skipped[0].dutyId, 10);
  const b = plan.slots.find((s) => s.dutyId === 11)!.memberId!;
  assert.ok([4, 5, 6].includes(b));
});

test('over 12 weeks effort stays balanced and everyone rotates through duties', () => {
  const totals = new Map(members.map((m) => [m.id, 0]));
  const last = new Map<string, number>();
  const seen = new Map<number, Set<number>>();
  for (let week = 1; week <= 12; week++) {
    const weeksSince = new Map([...last].map(([k, w]) => [k, week - w]));
    const plan = planWeek(input({ totals: new Map(totals), weeksSince }));
    for (const s of plan.slots) {
      const duty = duties.find((d) => d.id === s.dutyId)!;
      totals.set(s.memberId!, totals.get(s.memberId!)! + duty.points);
      last.set(`${s.memberId}:${s.dutyId}`, week);
      seen.set(s.memberId!, (seen.get(s.memberId!) ?? new Set()).add(s.dutyId));
    }
  }
  const values = [...totals.values()];
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread <= 4, `spread ${spread} too large: ${values}`); // at most one duty's worth
  for (const [id, set] of seen) assert.ok(set.size >= 3, `member ${id} only did ${[...set]}`);
});

test('results are deterministic', () => {
  const a = planWeek(input());
  const b = planWeek(input());
  assert.deepEqual(a, b);
});
