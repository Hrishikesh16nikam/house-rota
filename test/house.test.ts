import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/house.ts';
import { makeHouse } from './helpers.ts';

const WEEK = '2026-10-26';

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status);
}

test('setup creates the duties and a planned week follows every hard rule', async () => {
  const { house } = await makeHouse();
  const duties = await house.duties();
  assert.deepEqual(duties.map((d) => d.name).sort(), ['Kitchen', 'Living room', 'Trash', 'Washroom A', 'Washroom B']);
  const w = await house.week('current');
  assert.equal(w.start, WEEK);
  assert.equal(w.weekly.length, 5);
  assert.equal(new Set(w.weekly.map((a) => a.memberId)).size, 5, 'no doubles');
  assert.equal(w.free.length, 1);
  const washA = w.weekly.find((a) => a.dutyName === 'Washroom A')!;
  assert.ok([1, 2, 3].includes(washA.memberId!));
  assert.equal(w.trash.length, 7);
  assert.equal(w.trash[0].memberId, w.trash[6].memberId);
});

test('setup is one-time and validates input', async () => {
  const { house } = await makeHouse();
  await rejects(house.setup({ houseName: 'x', timezone: 'UTC', adminName: 'Z', adminPin: '246810', housemates: ['Y'], washrooms: [], kitchenSlots: 1 }), 409);
});

test('invites are single-use and PINs must not be trivial', async () => {
  const { house } = await makeHouse();
  const m = await house.addMember(1, 'C1');
  const { token } = await house.createInvite(1, m.id);
  await rejects(house.acceptInvite(token, '111111'), 400);
  await rejects(house.acceptInvite(token, '123456'), 400);
  await house.acceptInvite(token, '975310');
  await rejects(house.acceptInvite(token, '975310'), 410);
  await rejects(house.createInvite(2, m.id), 403); // only admins invite
});

test('sign-in: wrong PINs are rate limited per member', async () => {
  const { house } = await makeHouse();
  for (let i = 0; i < 5; i++) await rejects(house.login(3, '000000', `ip${i}`), 401);
  await rejects(house.login(3, '246810', 'ip9'), 429); // locked even with the right PIN
  const { token } = await house.login(4, '246810', 'ip9');
  assert.equal((await house.sessionMember(token))?.id, 4);
});

test('done, then a housemate confirms; nobody confirms their own', async () => {
  const { house } = await makeHouse();
  const k = (await house.week('current')).weekly.find((a) => a.dutyName === 'Kitchen')!;
  const other = [1, 2, 3, 4, 5, 6].find((id) => id !== k.memberId)!;
  await rejects(house.markDone(other, k.id), 403);
  await house.markDone(k.memberId!, k.id);
  await rejects(house.confirm(k.memberId!, k.id), 403);
  assert.equal((await house.confirm(other, k.id)).status, 'confirmed');
  const h = await house.history(5);
  assert.deepEqual(h.slice(0, 2).map((e) => e.type), ['duty.confirmed', 'duty.done']);
});

test('done duties auto-confirm after 24 hours; open ones become missed', async () => {
  const { house, setTime } = await makeHouse();
  const w = await house.week('current');
  await house.markDone(w.trash[0].memberId!, w.trash[0].id);
  setTime('2026-11-02T08:00:00Z');
  await house.finalize();
  assert.equal((await house.assignment(w.trash[0].id)).status, 'confirmed');
  assert.equal((await house.assignment(w.trash[1].id)).status, 'missed');
  assert.equal((await house.assignment(w.weekly[0].id)).status, 'missed');
});

test('flags need a reason; the admin resolves them', async () => {
  const { house } = await makeHouse();
  const l = (await house.week('current')).weekly.find((a) => a.dutyName === 'Living room')!;
  await house.markDone(l.memberId!, l.id);
  const flagger = [2, 3, 4, 5, 6].find((id) => id !== l.memberId)!;
  await rejects(house.flag(flagger, l.id, ' '), 400);
  const { notify } = await house.flag(flagger, l.id, 'Crumbs on the couch');
  assert.equal(notify.memberId, l.memberId);
  await rejects(house.resolve(flagger, l.id, 'accept'), 403);
  assert.equal((await house.resolve(1, l.id, 'redo')).status, 'pending');
});

test('swaps respect washroom groups and move points with the duty', async () => {
  const { house } = await makeHouse();
  const w = await house.week('current');
  const washA = w.weekly.find((a) => a.dutyName === 'Washroom A')!;
  await rejects(house.requestSwap(washA.memberId!, washA.id, 4, null), 400);
  const k = w.weekly.find((a) => a.dutyName === 'Kitchen')!;
  const l = w.weekly.find((a) => a.dutyName === 'Living room')!;
  const { swapId, notify } = await house.requestSwap(k.memberId!, k.id, l.memberId!, l.id);
  assert.equal(notify.memberId, l.memberId);
  await rejects(house.decideSwap(k.memberId!, swapId, 'accept'), 403);
  await house.decideSwap(l.memberId!, swapId, 'accept');
  assert.equal((await house.assignment(k.id)).memberId, l.memberId);
  assert.equal((await house.assignment(k.id)).originalMemberId, k.memberId);
  assert.equal((await house.assignment(l.id)).memberId, k.memberId);
});

test('an outdated swap expires instead of applying', async () => {
  const { house } = await makeHouse();
  const t = (await house.week('current')).trash[0];
  const target = [1, 2, 3, 4, 5, 6].find((id) => id !== t.memberId)!;
  const { swapId } = await house.requestSwap(t.memberId!, t.id, target, null);
  await house.markDone(t.memberId!, t.id);
  await rejects(house.decideSwap(target, swapId, 'accept'), 409);
});

test('away most of the week: weekly duty goes to someone free in the same washroom group', async () => {
  const { house } = await makeHouse();
  const w = await house.week('current');
  const washA = w.weekly.find((a) => a.dutyName === 'Washroom A')!;
  const away = washA.memberId!;
  const changes = await house.addAbsence(away, away, WEEK, '2026-10-30', 'Trip');
  assert.ok(changes.length > 0);
  const after = await house.week('current');
  const moved = after.weekly.find((a) => a.id === washA.id)!;
  assert.ok([1, 2, 3].includes(moved.memberId!) && moved.memberId !== away);
  assert.equal(moved.originalMemberId, away);
  const counts = new Map<number, number>();
  for (const a of after.weekly) counts.set(a.memberId!, (counts.get(a.memberId!) ?? 0) + 1);
  assert.ok([...counts.values()].every((n) => n === 1));
  for (const t of after.trash.filter((x) => x.date! <= '2026-10-30')) assert.notEqual(t.memberId, away);
});

test('history is append-only', async () => {
  const { house } = await makeHouse();
  await assert.rejects(house.db.run("UPDATE events SET type = 'x'"), /append-only/);
  await assert.rejects(house.db.run('DELETE FROM events'), /append-only/);
});

test('nudges are anonymous and limited to once a day per duty', async () => {
  const { house } = await makeHouse();
  const k = (await house.week('current')).weekly.find((a) => a.dutyName === 'Kitchen')!;
  const nudger = [1, 2, 3, 4, 5, 6].find((id) => id !== k.memberId)!;
  const r = await house.nudge(nudger, k.id);
  assert.equal(r.memberId, k.memberId);
  assert.equal((await house.history(1))[0].actor, null);
  await rejects(house.nudge(nudger, k.id), 429);
});

test('photos must be real images and expire after a week', async () => {
  const { house, setTime } = await makeHouse();
  const k = (await house.week('current')).weekly.find((a) => a.dutyName === 'Kitchen')!;
  await house.markDone(k.memberId!, k.id);
  await rejects(house.savePhoto(k.memberId!, k.id, new TextEncoder().encode('not an image')), 415);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await house.savePhoto(k.memberId!, k.id, jpeg)).hasPhoto, true);
  assert.deepEqual([...(await house.photo(k.id)).data], [...jpeg]);
  setTime('2026-11-03T13:00:00Z');
  await house.finalize();
  await rejects(house.photo(k.id), 404);
});

test('votes set duty points; admins can edit duties and add washroom groups', async () => {
  const { house } = await makeHouse();
  const living = (await house.duties()).find((d) => d.name === 'Living room')!;
  await house.vote(1, living.id, 5);
  await house.vote(2, living.id, 4);
  assert.equal((await house.duties()).find((d) => d.id === living.id)!.points, 4.5);
  await rejects(house.saveDuty(2, living.id, { name: 'X', icon: '✨', slots: 1, points: 2, eligible: null }), 403);
  const balcony = await house.saveDuty(1, null, { name: 'Balcony', icon: '🌿', slots: 1, points: 2, eligible: [1, 4] });
  assert.deepEqual(balcony.eligible, [1, 4]);
});

test('reminders: trash in the evening, weekly on Friday and Sunday, summary on Monday', async () => {
  const { house, setTime } = await makeHouse('2026-10-26T10:00:00Z');
  await house.week('current');
  const kinds = async () => (await house.dueReminders()).map((r) => r.key.split(':')[0]);
  assert.ok((await kinds()).includes('week'));
  assert.ok(!(await kinds()).includes('trash'));
  setTime('2026-10-26T18:30:00Z');
  assert.ok((await kinds()).includes('trash'));
  setTime('2026-10-30T19:00:00Z');
  assert.ok((await kinds()).includes('fri'));
  setTime('2026-11-01T12:30:00Z');
  assert.ok((await kinds()).includes('sun'));
});

test('deactivating someone signs them out and their future planning skips them', async () => {
  const { house } = await makeHouse();
  const { token } = await house.login(6, '246810', 'x');
  await house.updateMember(1, 6, { active: false });
  assert.equal(await house.sessionMember(token), null);
  const next = await house.week('next');
  assert.ok(next.weekly.every((a) => a.memberId !== 6));
  await rejects(house.updateMember(1, 1, { active: false }), 400);
});
