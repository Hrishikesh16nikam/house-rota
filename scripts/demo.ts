// npm run demo: a sample house (synthetic people) with four weeks of history,
// in ./data/local.db. Everyone's PIN is 246810.
import { addDays, weekStart } from '../src/domain/dates.ts';
import { localHouse } from './local.ts';

const { house } = await localHouse();
if (await house.isSetUp()) {
  console.log('A house already exists in data/local.db. Delete the data folder to start over.');
  process.exit(1);
}
const names = ['Asha', 'Ben', 'Chen', 'Diego', 'Elif', 'Farid'];
await house.setup({
  houseName: 'Maple Street', timezone: 'America/New_York', adminName: names[0], adminPin: '246810', housemates: names.slice(1),
  washrooms: [{ name: 'Upstairs washroom', members: names.slice(0, 3) }, { name: 'Downstairs washroom', members: names.slice(3) }],
  kitchenSlots: 2,
});
for (let id = 2; id <= 6; id++) {
  const { token } = await house.createInvite(1, id);
  await house.acceptInvite(token, '246810');
}
const current = weekStart(await house.today());
await house.db.run("UPDATE settings SET value = ? WHERE key = 'trashCycleStart'", addDays(current, -28));
for (const d of await house.duties()) for (let m = 1; m <= 6; m++) {
  await house.vote(m, d.id, d.kind === 'trash' ? 1 : d.name.includes('washroom') ? 4 + (m % 2) : d.name === 'Kitchen' ? 3 : 2);
}
for (let w = 4; w >= 1; w--) {
  const start = addDays(current, -7 * w);
  await house.ensureWeek(start);
  let n = 0;
  for (const a of await house.db.all<{ id: number }>("SELECT id FROM assignments WHERE week_start = ? AND status = 'pending'", start)) {
    n++;
    const missed = n % 13 === 0;
    await house.db.run('UPDATE assignments SET status = ?, done_at = ? WHERE id = ?', missed ? 'missed' : 'confirmed', missed ? null : `${addDays(start, 3)}T20:00:00.000Z`, a.id);
  }
}
const today = await house.today();
await house.week('current');
await house.db.run("UPDATE assignments SET status = 'confirmed', done_at = date || 'T23:00:00.000Z' WHERE week_start = ? AND date != '' AND date < ?", current, today);
const firstWeekly = await house.db.get<{ id: number }>("SELECT id FROM assignments WHERE week_start = ? AND date = '' ORDER BY id LIMIT 1", current);
if (firstWeekly) await house.db.run("UPDATE assignments SET status = 'confirmed', done_at = ? WHERE id = ?", `${today}T10:00:00.000Z`, firstWeekly.id);
const t = await house.db.get<{ id: number; member_id: number }>("SELECT id, member_id FROM assignments WHERE date = ? AND status = 'pending'", today);
if (t) await house.markDone(t.member_id, t.id);
if (addDays(today, 1) <= addDays(current, 6)) await house.addAbsence(5, 5, addDays(today, 1), addDays(today, 2), 'Visiting family');
console.log('Demo house ready. Sign in as anyone with PIN 246810, then: npm run local');
