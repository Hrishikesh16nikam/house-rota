import { fileURLToPath } from 'node:url';
import { nodeDb } from '../src/db-node.ts';
import { House } from '../src/house.ts';

export const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
export const PEPPER = 'test-pepper-0123456789';

/** The real house: 6 people, washroom A for A1-A3, B for B1-B3, kitchen x2. UTC clock. */
export async function makeHouse(startIso = '2026-10-26T12:00:00Z') {
  const clock = { now: new Date(startIso) };
  const house = new House(nodeDb(':memory:', MIGRATIONS), { pepper: PEPPER, now: () => clock.now });
  await house.setup({
    houseName: 'Test House', timezone: 'UTC', adminName: 'A1', adminPin: '246810',
    housemates: ['A2', 'A3', 'B1', 'B2', 'B3'],
    washrooms: [{ name: 'Washroom A', members: ['A1', 'A2', 'A3'] }, { name: 'Washroom B', members: ['B1', 'B2', 'B3'] }],
    kitchenSlots: 2,
  });
  await house.db.run("UPDATE settings SET value = '2026-10-26' WHERE key = 'trashCycleStart'");
  // Everyone joins with a PIN so tests can sign in as anyone.
  for (let id = 2; id <= 6; id++) {
    const { token } = await house.createInvite(1, id);
    await house.acceptInvite(token, '246810');
  }
  const ids = [1, 2, 3, 4, 5, 6];
  return { house, ids, setTime: (iso: string) => { clock.now = new Date(iso); } };
}
