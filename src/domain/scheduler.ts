// Plans all of a week's weekly duties at once.
//
// Apps that rotate each chore on its own schedule let rotations collide: one
// person ends up with both kitchen slots, or a washroom and the kitchen in
// the same week. Planning the whole week together makes those collisions
// impossible by construction.
//
// Hard rules (never broken):
//   1. A duty only goes to an eligible member (a washroom to its users).
//   2. A duty with several slots (the kitchen) gets different people.
//   3. Nobody gets two weekly duties, unless there are more slots than
//      available people; then as few people as possible double up.
//   4. Unavailable (away) members get nothing.
// Soft goals, combined into one cost:
//   - keep everyone's running effort points even (sum of squared deviation),
//   - avoid giving someone the same duty they had in the last two weeks.
//
// With 6 people and 5 slots there are at most 6^5 = 7,776 combinations, so
// the search simply tries all valid ones and keeps the cheapest. That is
// guaranteed optimal and easy to reason about; a larger house would call for
// a matching algorithm instead.

import type { Duty, Member } from './types.ts';

export interface PlanInput {
  members: Member[];
  duties: Duty[]; // weekly duties only
  unavailable: Set<number>;
  /** Effort points each member has earned so far, including this week's trash. */
  totals: Map<number, number>;
  /** How many weeks ago each member last did each duty: key `${memberId}:${dutyId}`. */
  weeksSince: Map<string, number>;
}

export interface PlannedSlot {
  dutyId: number;
  slot: number;
  memberId: number | null;
}

export interface Plan {
  slots: PlannedSlot[];
  /** Members who had to take a second weekly duty. */
  doubled: number[];
  /** Slots nobody eligible was available for, e.g. a washroom whose users are all away. */
  skipped: { dutyId: number; slot: number; reason: string }[];
  cost: number;
}

const RECENCY_PENALTY: Record<number, number> = { 1: 6, 2: 2 };
const DOUBLE_PENALTY = 1_000_000;

export function planWeek(input: PlanInput): Plan {
  const available = input.members
    .filter((m) => m.active && !input.unavailable.has(m.id))
    .map((m) => m.id)
    .sort((a, b) => a - b);

  const allSlots = input.duties
    .filter((d) => d.kind === 'weekly')
    .flatMap((d) => Array.from({ length: d.slots }, (_, slot) => ({ duty: d, slot })));

  const skipped: Plan['skipped'] = [];
  const open: { duty: Duty; slot: number; candidates: number[] }[] = [];
  for (const s of allSlots) {
    const candidates = available.filter((id) => s.duty.eligible === null || s.duty.eligible.includes(id));
    const needed = s.slot + 1; // the second kitchen slot needs a second distinct person
    if (candidates.length < needed) {
      skipped.push({
        dutyId: s.duty.id,
        slot: s.slot,
        reason: candidates.length === 0 ? 'nobody who uses it is home' : 'not enough eligible people home',
      });
    } else {
      open.push({ ...s, candidates });
    }
  }
  // Fill the most constrained slots first so the search prunes early.
  open.sort((a, b) => a.candidates.length - b.candidates.length || b.duty.points - a.duty.points || a.duty.id - b.duty.id || a.slot - b.slot);

  const base = new Map(available.map((id) => [id, input.totals.get(id) ?? 0]));
  const result =
    search(open, base, input.weeksSince, 1) ?? // first try: nobody doubles up
    search(open, base, input.weeksSince, open.length); // otherwise allow doubles, heavily penalised

  if (!result) {
    // Only possible if a multi-slot duty can't get distinct people; handled above.
    throw new Error('no valid weekly plan');
  }

  const assigned = new Map(result.choice.map((memberId, i) => [`${open[i].duty.id}:${open[i].slot}`, memberId]));
  const slots = allSlots.map((s) => ({
    dutyId: s.duty.id,
    slot: s.slot,
    memberId: assigned.get(`${s.duty.id}:${s.slot}`) ?? null,
  }));
  const counts = new Map<number, number>();
  for (const id of result.choice) counts.set(id, (counts.get(id) ?? 0) + 1);
  const doubled = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  return { slots, doubled, skipped, cost: result.cost };
}

function search(
  open: { duty: Duty; slot: number; candidates: number[] }[],
  base: Map<number, number>,
  weeksSince: Map<string, number>,
  maxPerMember: number,
): { choice: number[]; cost: number } | null {
  let best: { choice: number[]; cost: number } | null = null;
  const choice: number[] = [];
  const count = new Map<number, number>();

  const evaluate = () => {
    const projected = new Map(base);
    let cost = 0;
    choice.forEach((memberId, i) => {
      const { duty } = open[i];
      projected.set(memberId, (projected.get(memberId) ?? 0) + duty.points);
      cost += RECENCY_PENALTY[weeksSince.get(`${memberId}:${duty.id}`) ?? 0] ?? 0;
    });
    const values = [...projected.values()];
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    cost += values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    for (const n of count.values()) if (n > 1) cost += DOUBLE_PENALTY * (n - 1);
    return cost;
  };

  const step = (i: number) => {
    if (i === open.length) {
      const cost = evaluate();
      // Strictly-better only, so ties keep the first plan found: results are deterministic.
      if (!best || cost < best.cost - 1e-9) best = { choice: [...choice], cost };
      return;
    }
    const { duty, slot, candidates } = open[i];
    for (const memberId of candidates) {
      if ((count.get(memberId) ?? 0) >= maxPerMember) continue;
      // Two slots of the same duty never go to the same person.
      const sameDutyTaken = choice.some((m, j) => m === memberId && open[j].duty.id === duty.id && open[j].slot !== slot);
      if (sameDutyTaken) continue;
      choice.push(memberId);
      count.set(memberId, (count.get(memberId) ?? 0) + 1);
      step(i + 1);
      count.set(memberId, (count.get(memberId) ?? 0) - 1);
      choice.pop();
    }
  };

  step(0);
  return best;
}
